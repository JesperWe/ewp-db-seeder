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
    .option( '--continue' )

program.parse()

const options = program.opts()
const skipRegister = !!options.continue

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

const suEmail = "su@journeyman.se"
const ouEmail = "ou@journeyman.se"

const main = async() => {
    const pgClient = new Client( pgCreds )
    await pgClient.connect()

    // Register user
    if( !skipRegister ) {
        let resp = await register( suEmail )
        if( resp.error ) {
            console.log( resp )
            process.exit( 1 )
        }
        su = resp.register

        // Set email verified
        resp = await pgClient.query( 'UPDATE users SET email_verified_at = now() WHERE id = $1', [ su.user.id ] )

        console.log( "New Superuser ID ", su.user.id )

        resp = await register( ouEmail )
        if( resp.error ) {
            console.log( resp )
            process.exit( 1 )
        }
        ou = resp.register

        // Set email verified
        resp = await pgClient.query( 'UPDATE users SET email_verified_at = now() WHERE id = $1', [ ou.user.id ] )

        console.log( "New Org user ID ", ou.user.id )
    }

    // Login
    const creds = await login( suEmail )
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

        console.log( "Org", org )

        // Make superuser an actual superuser
        const authZed = v1.NewClient( 'somerandomkey', 'localhost:50051', v1.ClientSecurity.INSECURE_PLAINTEXT_CREDENTIALS )
        const { promises: authZedClient } = authZed // access client.promises

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

    console.log( "Current User ID", superuser.id )
    console.log( "Current Org ID", orgId )

    // Invite org user to org
    const invite = gql`
        mutation {
            addInvitation(orgId: "${orgId}", input: { email: "${ouEmail}", role: OWNER }) {
                id
                orgId
                email
                role
            }
        }`

    let resp = await authorizedClient.request( invite )
    const inviteId = resp.addInvitation.id
    console.log( "Created Org user invite id", inviteId )

    const ouCreds = await login( ouEmail )
    const ouClient = new GraphQLClient( gqurl, {
        headers: {
            authorization: `Bearer ${ ouCreds.authenticate.accessToken }`,
        },
    } )

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
    console.log( "Invite accepted, role", resp.acceptInvitation.role )

    process.exit( 0 )
}

main()
