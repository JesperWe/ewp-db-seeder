const { program } = require( 'commander' )
const { request, gql, GraphQLClient } = require( 'graphql-request' )
const { v1 } = require( '@authzed/authzed-node' )
const { Client } = require( 'pg' )

const pgCreds = {
    host: 'localhost',
    port: 5432,
    database: 'prince',
    user: 'prince',
    password: '123',
}

const gqurl = 'http://localhost:8000/graphql'

program
    .requiredOption( '-su, --super-user <email>',  )
    .requiredOption( '-ou, --organization-user <email>',  )
    .option( '--skipRegister' ) // Mostly for debugging this utility itself

program.parse()

const options = program.opts()
const skipRegister = !!options.skipRegister

const register = async( email ) => {
    const document = gql`
        mutation {
            register(
                input: {
                    name: "Super User"
                    email: "${email}"
                    password: "aA111111"
                }
            ) {
                accessToken
                expiresIn
                refreshToken
                token
                user {
                    id
                }
            }
        }
    `
    const resp = await request( gqurl, document )
    return resp
}

const login = async( email ) => {
    const query = gql`
        mutation Authenticate {
            authenticate(email: "${email}", password: "aA111111") {
                token
                accessToken
                expiresIn
                refreshToken
                user {
                    id name email
                }
                subject {
                    ... on User {
                        verified
                    }
                }
            }
        }
    `
    return await request( gqurl, query )
}

const createOrg = async( client, domain ) => {
    const query = gql`
        mutation CreateOrganization {
            createOrganization(
                input: { name: "${domain}", domain: "${domain}", ola: "1" }
            ) {
                name
                id
            }
        }
    `
    return (await client.request( query )).createOrganization
}

const createRelationship = async( client, objectType, objectId, relation, subjectType, subjectId ) => {
    const writeRelationshipRequest = v1.WriteRelationshipsRequest.create( {
        updates: [
            v1.RelationshipUpdate.create( {
                relationship: v1.Relationship.create( {
                    resource: v1.ObjectReference.create( {
                        objectType: objectType,
                        objectId: objectId,
                    } ),
                    relation: relation,
                    subject: v1.SubjectReference.create( {
                        object: v1.ObjectReference.create( {
                            objectType: subjectType,
                            objectId: subjectId,
                        } ),
                    } ),
                } ),
                operation: v1.RelationshipUpdate_Operation.CREATE,
            } ),
        ],
    } )

    return client.writeRelationships( writeRelationshipRequest )
}

const createDeviceType = async( client, id, name ) => {
    const query = gql`
        mutation {
            addDeviceType(input: { id: "${id}", name: "${name}" }) {
                id
                name
            }
        }`

    return (await client.request( query )).addDeviceType
}

const createPlaceType = async( client, id, name ) => {
    const query = gql`
        mutation {
            addPlaceType(input: { id: "${id}", name: "${name}" }) {
                id
                name
            }
        }`

    return (await client.request( query )).addPlaceType
}

const getProfile = async( client ) => {
    const query = gql`
        fragment MembershipFields on Membership {
            role
            userId
            orgId
            organization {
                domain
                logoUrl
                name
            }
        }

        fragment InvitationFields on Invitation {
            orgId
            email
            role
            status
        }

        fragment ProfileFields on User {
            name
            email
            verified
            superAdmin
            memberships {
                ...MembershipFields
            }
            invitations(filter: { status: [PENDING, EXPIRED] }) {
                ...InvitationFields
            }
        }

        query Profile {
            profile {
                ...ProfileFields
            }
        }`

    const resp = await client.request( query )
    return resp.profile
}

const main = async() => {
    const pgClient = new Client( pgCreds )
    await pgClient.connect()

    const authZed = v1.NewClient( 'somerandomkey', 'localhost:50051', v1.ClientSecurity.INSECURE_PLAINTEXT_CREDENTIALS )
    const { promises: authZedClient } = authZed // access client.promises

    // Register user
    if( !skipRegister ) {
        let resp = await register( options.superUser )
        if( resp.error ) {
            console.log( resp )
            process.exit( 1 )
        }
        su = resp.register

        // Set email verified
        resp = await pgClient.query( 'UPDATE users SET email_verified_at = now() WHERE id = $1', [ su.user.id ] )

        resp = await register( options.organizationUser )
        if( resp.error ) {
            console.log( resp )
            process.exit( 1 )
        }
        ou = resp.register

        // Set email verified
        resp = await pgClient.query( 'UPDATE users SET email_verified_at = now() WHERE id = $1', [ ou.user.id ] )
    }

    // Login
    const creds = await login( options.superUser )
    if( creds.error ) {
        console.log( resp )
        process.exit( 1 )
    }

    const superuser = creds.authenticate.user

    const authorizedClient = new GraphQLClient( gqurl, {
        headers: {
            authorization: `Bearer ${ creds.authenticate.accessToken }`,
        },
    } )

    if( !skipRegister ) {
        // Create first Organization
        const org = await createOrg( authorizedClient, "domain" )

        // Make superuser an actual superuser
        await createRelationship( authZedClient, "ewp/role_binding", "superuser", "member", "ewp/user", superuser.id )
        await createRelationship( authZedClient, "ewp/role_binding", "superuser", "role", "ewp/role", "platform_super_admin" )
        await createRelationship( authZedClient, "ewp/platform", "ewp", "granted", "ewp/role_binding", "superuser" )
        console.log( "Created superuser binding for", superuser.id )
    }

    const profile = await getProfile( authorizedClient )
    const orgId = profile.memberships?.[0]?.orgId

    // Seed the various _types tables
    if( !skipRegister ) {
        await createDeviceType( authorizedClient, 'Kleeo', 'Kleeo Desk Booker' )
        await createDeviceType( authorizedClient, 'Naso', 'Naso Room Booker' )
        await createPlaceType( authorizedClient, 'ROOM', 'Room' )
        await createPlaceType( authorizedClient, 'FLOOR', 'Floor' )
        await createPlaceType( authorizedClient, 'BUILDING', 'Building' )
        console.log( "Seeded object type tables." )
    }

    // Invite org user to org
    const invite = gql`
        mutation {
            addInvitation(orgId: "${orgId}", input: { email: "${options.organizationUser}", role: OWNER }) {
                id
                orgId
                email
                role
            }
        }`

    let resp = await authorizedClient.request( invite )
    const inviteId = resp.addInvitation.id

    // Login as non-superadmin user.
    const ouCreds = await login( options.organizationUser )
    const orgUser = ouCreds.authenticate.user

    // Create a client for non-superadmin user requests.
    const ouClient = new GraphQLClient( gqurl, {
        headers: {
            authorization: `Bearer ${ ouCreds.authenticate.accessToken }`,
        },
    } )

    // Accept the invite
    const accept = gql`
        mutation AcceptInvitation {
            acceptInvitation(id: "${inviteId}") {
                id
                expiresAt
                status
                role
                membership {
                    organization {
                        id
                        name
                    }
                    user {
                        id
                        name
                        email
                    }
                }
            }
        }`

    resp = await ouClient.request( accept )

    // Set email verified
    resp = await pgClient.query( 'UPDATE users SET email_verified_at = now() WHERE id = $1', [ orgUser.id ] )

    console.log( "\n--- All Done! ---" )
    console.log( "Org ID", orgId )
    console.log( "Superuser ID", superuser.id )
    console.log( "Org user ID", orgUser.id )

    await pgClient.end()
    process.exit( 0 )
}

main()
