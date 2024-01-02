const { program } = require( 'commander' )
const { request, gql, GraphQLClient } = require( 'graphql-request' )
const { v1 } = require( '@authzed/authzed-node' )
const { Client } = require( 'pg' )
const { v4: uuidv4 } = require( 'uuid' )

const pgCreds = {
    host: 'localhost',
    port: 5432,
    database: 'prince',
    user: 'prince',
    password: '123',
}

program
    .name( "ewp-db-seeder" )
    .usage( "-su <superuser-email> -ou <orguser-email>" )
    .requiredOption( '-su, --super-user <email>', )
    .requiredOption( '-ou, --organization-user <email>', )
    .option( '-p, --password <password>', 'Optional password', 'aA111111' )
    .option( '-url, --backend-url <url>', 'Optional backend url', 'http://localhost:8000/graphql' )
    .option( '--debug-skip-register', 'Mostly used when debugging this script itself' )

program.showHelpAfterError( '\n(Add --help for additional information)\n' )
program.parse()

const options = program.opts()
const skipRegister = !!options.debugSkipRegister

const register = async( email ) => {
    const document = gql`
		mutation {
			register(
				input: {
					name: "Super User"
					email: "${email}"
					password: "${options.password}"
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
    const resp = await request( options.backendUrl, document )
    return resp
}

const login = async( email ) => {
    const query = gql`
		mutation Authenticate {
			authenticate(email: "${email}", password: "${options.password}") {
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
    return await request( options.backendUrl, query )
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

const createBuilding = async( client, orgid, name ) => {
    const query = gql`mutation {
		addBuilding(
			orgId: "${orgid}",
			input: { name: "${name}" }
		) {
			id
		}
	}`

    return (await client.request( query )).addBuilding
}

const createFloor = async( client, orgid, buildingId, name ) => {
    const query = gql`mutation {
		addFloor(
			orgId: "${orgid}",
			buildingId: "${buildingId}",
			input: { name: "${name}" }
		) {
			id
		}
	}`

    return (await client.request( query )).addFloor
}

const createRoom = async( client, orgid, floorId, name, capacity, email ) => {
    const query = gql`mutation {
		addRoom(
			orgId: "${orgid}"
			input: {
				floorId: "${floorId}"
				name: "${name}"
				capacity: ${capacity}
				email: "${email}"
			}
		) {
			id
		}
	}`

    return (await client.request( query )).addRoom
}

const createResourceType = async( client, id, name ) => {
    const query = gql`
		mutation {
			addResourceType(input: { id: "${id}", name: "${name}" }) {
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

    // Is database empty?
    try {
        await pgClient.connect()
        const resp = await pgClient.query( 'SELECT id FROM users;' )
        if( resp.rowCount > 0 && !skipRegister ) {
            console.log( " ! Aborting since the database already has content. Re-create it before running again." )
            process.exit( 1 )
        }
    } catch( e ) {
        if( e.code === '42P01' )
            console.log( " ! Aborting since the database is empty. Start backend first so migrations are run." )
        else if( e.code === 'ECONNREFUSED' )
            console.log( " ! Aborting. Database is not running, or not on the default port." )
        else console.log( e )
        process.exit( 1 )
    }

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

    const authorizedClient = new GraphQLClient( options.backendUrl, {
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
        await createDeviceType( authorizedClient, 'KLEEO', 'Kleeo Desk Booker' )
        await createDeviceType( authorizedClient, 'NASO', 'Naso Room Booker' )
        await createResourceType( authorizedClient, 'ROOM', 'Room' )
        await createResourceType( authorizedClient, 'DESK', 'Desk' )
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

    let inviteId
    if( !skipRegister ) {
        let resp = await authorizedClient.request( invite )
        inviteId = resp.addInvitation.id
    }

    // Login as non-superadmin user.
    const ouCreds = await login( options.organizationUser )
    const orgUser = ouCreds.authenticate.user

    // Create a client for non-superadmin user requests.
    const ouClient = new GraphQLClient( options.backendUrl, {
        headers: {
            authorization: `Bearer ${ ouCreds.authenticate.accessToken }`,
        },
    } )

    // Accept the invite
    if( !skipRegister ) {
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
    }

    // Set email verified
    resp = await pgClient.query( 'UPDATE users SET email_verified_at = now() WHERE id = $1', [ orgUser.id ] )

    // Some places/resources
    buildingA = await createBuilding( authorizedClient, orgId, "Builing Alpha" )
    buildingB = await createBuilding( authorizedClient, orgId, "Builing Bravo" )
    buildingC = await createBuilding( authorizedClient, orgId, "Builing Charlie" )
    buildingD = await createBuilding( authorizedClient, orgId, "Builing Delta" )

    floorA1 = await createFloor( authorizedClient, orgId, buildingA.id, "Alpha floor 1" )
    floorA2 = await createFloor( authorizedClient, orgId, buildingA.id, "Alpha floor 2" )
    floorB1 = await createFloor( authorizedClient, orgId, buildingB.id, "Bravo floor 1" )
    floorC1 = await createFloor( authorizedClient, orgId, buildingC.id, "Charlie floor 1" )
    floorD1 = await createFloor( authorizedClient, orgId, buildingD.id, "Delta floor 1" )

    roomA1_1 = await createRoom( authorizedClient, orgId, floorA1.id, "Meet A1:1", 6, "a1@example.com" )
    roomA1_2 = await createRoom( authorizedClient, orgId, floorA1.id, "Meet A1:2", 9, "a2@example.com" )
    roomA1_3 = await createRoom( authorizedClient, orgId, floorA1.id, "Meet A1:3", 12, "a3@example.com" )
    roomA2_1 = await createRoom( authorizedClient, orgId, floorA2.id, "Meet A2:1", 17, "a4@example.com" )
    roomA2_2 = await createRoom( authorizedClient, orgId, floorA2.id, "Meet A2:2", 4, "a5@example.com" )

    roomC1_1 = await createRoom( authorizedClient, orgId, floorC1.id, "Meet C1:1", 5, "c1@example.com" )
                                                
    console.log( "\n--- All Done! ---" )
    console.log( orgId, "Organization" )
    console.log( superuser.id, "Superuser" )
    console.log( orgUser.id, "Org user" )
    await pgClient.end()
    process.exit( 0 )
}

main()
