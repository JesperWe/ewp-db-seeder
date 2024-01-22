import { program } from "commander"
import { request, gql, GraphQLClient } from "graphql-request"
import { v1 } from "@authzed/authzed-node"
import pg from "pg"
import { v4 as uuidv4 } from "uuid"
import fs from "fs"
import csv from 'csvtojson'
import dayjs from 'dayjs'
import random from 'random'

const { Client } = pg

const pgCreds = {
    host: "localhost",
    port: 5432,
    database: "prince",
    user: "prince",
    password: "123",
}

program
    .name( "ewp-db-seeder" )
    .usage( "-su <superuser-email> -ou <orguser-email>" )
    .requiredOption( "-su, --super-user <email>" )
    .requiredOption( "-ou, --organization-user <email>" )
    .option( "-p, --password <password>", "Optional password", "aA111111" )
    .option( "-url, --backend-url <url>", "Optional backend url", "http://localhost:8000/graphql" )
    .option( "--debug-skip-register", "Mostly used when debugging this script itself" )
    .option( "-cal-sources, --calendar-sources", "Seed calendar source data", false )
    .option( "-cal-users, --calendar-users", "Seed calendar sources data", false )
    .option( "-cal, --calendar", "Same as using both -cal-users && -cal-sources", false )
    .option( "-ms, --microsoft-credentials <path>", "Seed calendar data", "./.devenv/ms-credentials.json" )
    .option( "-goog, --google-credentials <path>", "Seed calendar data", "./.devenv/google-credentials.json" )
    .option( "-stats, --booking-statistics", "Only do random bookings for KPIs" )

program.showHelpAfterError( "\n(Add --help for additional information)\n" )
program.parse()

const options = program.opts()

const skipRegister = !!options.debugSkipRegister

const registerAdmin = async( email ) => {
    return registerUser( "Super User", email, options.password )
}

const registerUser = async( name, email, password ) => {
    const document = gql`
		mutation {
			register(
				input: {
					name: "${name}"
					email: "${email}"
					password: "${password}"
				}
			) {
				accessToken
				expiresIn
				refreshToken
				token
				user {
					id,
					email
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

    const res = await client.request( query )
    return res.addRoom
}

const createDesk = async( client, orgid, floorId, name ) => {
    const query = gql`mutation {
		addDesk(
			orgId: "${orgid}"
			input: {
				floorId: "${floorId}"
				name: "${name}"
				deskType: HOT
			}
		) {
			id
		}
	}`
    const res = await client.request( query )
    return res.addDesk
}

const createDeskBooking = async( client, orgid, deskId, userId, start, end ) => {
    const query = gql`mutation {
		addBooking(
			orgId: "${orgid}"
			input: {
				deskId: "${deskId}"
				userId: "${userId}"
				startTime: "${start.toISOString()}"
				endTime: "${end.toISOString()}"
			}
		) {
			id
		}
	}`
    return (await client.request( query )).addRoomBooking
}

const createRoomBooking = async( client, orgid, roomId, userId, start, end ) => {
    const query = gql`mutation {
		addRoomBooking(
			orgId: "${orgid}"
			input: {
				roomId: "${roomId}"
				userId: "${userId}"
				title: ""
				startTime: "${start.toISOString()}"
				endTime: "${end.toISOString()}"
			}
		) {
			id
		}
	}`
    return (await client.request( query )).addRoomBooking
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
		}
    `

    const resp = await client.request( query )
    return resp.profile
}

const createGoogleSource = async( orgId, credentials ) => {
    const query = gql`mutation {
		addCalendarSource(
			orgId: "${orgId}"
			input: {
				settings: {
					google: {
						resourceAdmin: "admin@g.evoko.dev"
						serviceAccountJson: "${credentials}"
					}
				}
			}
		){
			id
		}
	}`

    return (await request( options.backendUrl, query )).addCalendarSource
}

const createMicrosoftSource = async( orgId, credentials ) => {
    const query = gql`mutation {
		addCalendarSource(
			orgId: "${orgId}"
			input: {
				settings: {
					microsoft: {
						secret: "${credentials.secret}"
						clientId: "${credentials.clientId}"
						tenantId: "${credentials.tenantId}"
					}
				}
			}
		){
			id
		}
	}`

    return (await request( options.backendUrl, query )).addCalendarSource
}
const inviteUser = ( orgId, email, role ) => {
    const query = gql`
		mutation {
			addInvitation(orgId: "${orgId}", input: { email: "${email}", role: ${role} }) {
				id
				orgId
				email
				role
			}
		}`

    return query
}

const acceptInvitation = ( inviteId ) => {
    return gql`
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
}

const createCalendarResources = async( authorizedClient, pgClient ) => {
    const any = options.calendar || options.calendarSources || options.calendarUsers
    const sources = options.calendar || options.calendarSources
    const users = options.calendar || options.calendarUsers

    let googleOrg
    let msOrg
    if( any ) {
        try {
            googleOrg = await createOrg( authorizedClient, "googleorg" )
            msOrg = await createOrg( authorizedClient, "microsoftorg" )
        } catch( ex ) {
            console.log( "! Error creating calendar organizations" )
            return
        }
    }

    let googleSource
    let msSource
    if( sources ) {
        try {
            const googleCredentials = fs.readFileSync( options.googleCredentials, "utf-8" )
            let c = JSON.parse( googleCredentials )
            c["private_key"] = c["private_key"].replace( /\n/g, "\\n" )
            googleSource = (await createGoogleSource( googleOrg.id, JSON.stringify( c ).replace( /"/g, '\\"' ) )).addCalendarSource
        } catch( error ) {
            console.log( "! Cannot create google calendar source: ", options.googleCredentials, "error: ", error )
        }

        try {
            const microsoftCredentials = fs.readFileSync( options.microsoftCredentials, "utf-8" )
            msSource = await createMicrosoftSource( msOrg.id, JSON.parse( microsoftCredentials ) )
        } catch( ex ) {
            console.log( "! Cannot create microsoft calendar source" )
        }
    }

    if( googleOrg && users ) {
        try {
            const orgId = googleOrg.id
            const user = await registerUser( "Pam Beasly", "pam@g.evoko.dev", options.password )
            await pgClient.query( "UPDATE users SET email_verified_at = now() WHERE id = $1", [ user.register.user.id ] )
            const invite = await authorizedClient.request( inviteUser( orgId, user.register.user.email, "USER" ) )
            // Login as non-superadmin user.
            const ouCreds = await login( "pam@g.evoko.dev" )
            const orgUser = ouCreds.authenticate.user

            // Create a client for non-superadmin user requests.
            const ouClient = new GraphQLClient( options.backendUrl, {
                headers: {
                    authorization: `Bearer ${ ouCreds.authenticate.accessToken }`,
                },
            } )
            const acceptRes = await ouClient.request( acceptInvitation( invite.addInvitation.id ) )

            const buildingA = await createBuilding( authorizedClient, orgId, "Building Google" )
            const floorA1 = await createFloor( authorizedClient, orgId, buildingA.id, "Google floor 1" )
            const floorA2 = await createFloor( authorizedClient, orgId, buildingA.id, "Google floor 2" )
            const roomA1_1 = await createRoom( authorizedClient, orgId, floorA1.id, "Demeter", 6, "c_18885sc0jj4hej7onle52q2p0q3ma@resource.calendar.google.com" )
            const roomA2_1 = await createRoom( authorizedClient, orgId, floorA2.id, "Hades", 17, "c_188e73l8pim36jn8ndr7g7q7e4b0a@resource.calendar.google.com" )

            // create membership
        } catch( err ) {
            console.log( "! Error creating google calendar source info: ", err )
        }
    }

    if( msOrg && users ) {
        try {
            const orgId = msOrg.id
            const user = await registerUser( "Pam Beasly", "pam@microsoft.evoko.dev", options.password )
            await pgClient.query( "UPDATE users SET email_verified_at = now() WHERE id = $1", [ user.register.user.id ] )
            const invite = await authorizedClient.request( inviteUser( orgId, user.register.user.email, "USER" ) )
            // Login as non-superadmin user.
            const ouCreds = await login( "pam@microsoft.evoko.dev" )
            const orgUser = ouCreds.authenticate.user

            // Create a client for non-superadmin user requests.
            const ouClient = new GraphQLClient( options.backendUrl, {
                headers: {
                    authorization: `Bearer ${ ouCreds.authenticate.accessToken }`,
                },
            } )
            const acceptRes = await ouClient.request( acceptInvitation( invite.addInvitation.id ) )

            const buildingA = await createBuilding( authorizedClient, orgId, "Building Microsoft" )
            const floorA1 = await createFloor( authorizedClient, orgId, buildingA.id, "Microsoft floor 1" )
            const floorA2 = await createFloor( authorizedClient, orgId, buildingA.id, "Microsoft floor 2" )
            const roomA1_1 = await createRoom( authorizedClient, orgId, floorA1.id, "Apollo", 6, "apollo@microsoft.evoko.dev" )
            const roomA2_1 = await createRoom( authorizedClient, orgId, floorA2.id, "Athena", 17, "athena@microsoft.evoko.dev" )
            const deskMS1 = await createDesk( authorizedClient, orgId, floorA1.id, "Desk 1:17" )
            const deskMS2 = await createDesk( authorizedClient, orgId, floorA1.id, "Desk 1:3" )

            // create membership
        } catch( err ) {
            console.log( "! Error creating microsoft calendar source: ", err )
        }
    }
}

const createBookingsForStatistics = async( pgClient ) => {

    const randomN = n => Math.floor( Math.random() * n )
    const bookingStartHourAM = random.normal( 10, 1.5 )
    const bookingStartHourPM = random.normal( 15, 1.5 )

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

    const resp = await pgClient.query( "SELECT * FROM places WHERE place_type_id = 'FLOOR';" )
    const floors = resp.rows
    const noFloors = floors.length

    // Load CSV file of random resources
    const resources = await csv().fromFile( "resources.csv" )
    let created
    for( const r of resources ) {
        const floor = floors[randomN( noFloors )]
        if( r.type === "DESK" ) {
            created = await createDesk( authorizedClient, floor.org_id, floor.id, r.name )
        } else {
            created = await createRoom( authorizedClient, floor.org_id, floor.id, r.name, 2 + 2 * randomN( 10 ), r.name + "@email.com" )
        }

        // Fill up last month with bookings. Inefficient repeated queries but who cares....
        const u = await pgClient.query( "SELECT u.* FROM users u, memberships m WHERE m.user_id = u.id AND m.org_id = $1;", [ floor.org_id ] )
        const users = u.rows
        const noUsers = users.length

        for( let i = 0; i < 30; i++ ) {

            const d = dayjs().add( -1 * i, 'day' )
            let time = d.hour( 8 ).startOf( 'hour' )
            let end
            const noBookings = Math.max( 0, randomN( 5 ) - 1 )

            // The idea here is to use two normal distributions for am/pm
            // to get a realistic profile with less bookings during lunch hour.

            for( let b = 0; b < noBookings; b++ ) {

                const AMbookingStart = bookingStartHourAM()
                let h = Math.floor( AMbookingStart )
                time = time.hour( h )
                time = time.minute( Math.floor( (AMbookingStart - h) * 60 ) )
                end = time.add( 15 * (randomN( 5 ) + 1), 'minute' )

                let user = users[randomN( noUsers )].id

                try {
                    if( r.type === "DESK" ) {
                        await createDeskBooking( authorizedClient, floor.org_id, created.id, user, time, end )
                    } else {
                        await createRoomBooking( authorizedClient, floor.org_id, created.id, user, time, end )
                    }
                } catch( e ) { /* ignore colliding bookings */
                }

                const PMbookingStart = bookingStartHourPM()
                h = Math.floor( PMbookingStart )
                time = time.hour( h )
                time = time.minute( Math.floor( (PMbookingStart - h) * 60 ) )
                end = time.add( 15 * (randomN( 5 ) + 1), 'minute' )

                user = users[randomN( noUsers )].id

                try {
                    if( r.type === "DESK" ) {
                        await createDeskBooking( authorizedClient, floor.org_id, created.id, user, time, end )
                    } else {
                        await createRoomBooking( authorizedClient, floor.org_id, created.id, user, time, end )
                    }
                } catch( e ) { /* ignore colliding bookings */
                }
            }
        }
    }

    // For all these bookings, do some random checkins
    const allBooking = await pgClient.query( "SELECT b.* FROM bookings b" )
    for( const b of allBooking.rows ) {
        if( randomN( 10 ) > 3 ) {
            const during = b.during.split( ',' )
            let t = dayjs( during[0].split( '"' )[1] ).add( randomN( 15 ) - 4, 'minute' )
            if( t.isAfter( during[1].split( '"' )[1] ) ) t = dayjs( during[0].split( '"' )[1] )
            await pgClient.query( "UPDATE bookings SET checked_in_at = $1 WHERE id = $2", [ t.toISOString(), b.id ] )
        }
    }
}

const main = async() => {
    const pgClient = new Client( pgCreds )

    // Is database empty?
    try {
        await pgClient.connect()
        const resp = await pgClient.query( "SELECT id FROM users;" )
        if( resp.rowCount > 0 && !skipRegister && !options.bookingStatistics ) {
            console.log( " ! Aborting since the database already has content. Re-create it before running again." )
            process.exit( 1 )
        }
    } catch( e ) {
        if( e.code === "42P01" ) console.log( " ! Aborting since the database is empty. Start backend first so migrations are run." )
        else if( e.code === "ECONNREFUSED" ) console.log( " ! Aborting. Database is not running, or not on the default port." )
        else console.log( e )
        process.exit( 1 )
    }

    // Booking stats is meant to be run as a separate step only if desired.
    if( options.bookingStatistics ) {
        await createBookingsForStatistics( pgClient )
        process.exit( 0 )
    }

    const authZed = v1.NewClient( "somerandomkey", "localhost:50051", v1.ClientSecurity.INSECURE_PLAINTEXT_CREDENTIALS )
    const { promises: authZedClient } = authZed // access client.promises

    // Register user
    if( !skipRegister ) {
        let resp = await registerAdmin( options.superUser )
        if( resp.error ) {
            console.log( resp )
            process.exit( 1 )
        }
        let su = resp.register

        // Set email verified
        resp = await pgClient.query( "UPDATE users SET email_verified_at = now() WHERE id = $1", [ su.user.id ] )

        resp = await registerAdmin( options.organizationUser )
        if( resp.error ) {
            console.log( resp )
            process.exit( 1 )
        }
        let ou = resp.register

        // Set email verified
        resp = await pgClient.query( "UPDATE users SET email_verified_at = now() WHERE id = $1", [ ou.user.id ] )
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
        await createDeviceType( authorizedClient, "KLEEO", "Kleeo Desk Booker" )
        await createDeviceType( authorizedClient, "NASO", "Naso Room Booker" )
        await createResourceType( authorizedClient, "ROOM", "Room" )
        await createResourceType( authorizedClient, "DESK", "Desk" )
        await createPlaceType( authorizedClient, "FLOOR", "Floor" )
        await createPlaceType( authorizedClient, "BUILDING", "Building" )
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
        let resp = await ouClient.request( accept )
    }

    // Set email verified
    let resp = await pgClient.query( "UPDATE users SET email_verified_at = now() WHERE id = $1", [ orgUser.id ] )

    // Some places/resources
    const buildingA = await createBuilding( authorizedClient, orgId, "Builing Alpha" )
    const buildingB = await createBuilding( authorizedClient, orgId, "Builing Bravo" )
    const buildingC = await createBuilding( authorizedClient, orgId, "Builing Charlie" )
    const buildingD = await createBuilding( authorizedClient, orgId, "Builing Delta" )

    const floorA1 = await createFloor( authorizedClient, orgId, buildingA.id, "Alpha floor 1" )
    const floorA2 = await createFloor( authorizedClient, orgId, buildingA.id, "Alpha floor 2" )
    const floorB1 = await createFloor( authorizedClient, orgId, buildingB.id, "Bravo floor 1" )
    const floorC1 = await createFloor( authorizedClient, orgId, buildingC.id, "Charlie floor 1" )
    const floorD1 = await createFloor( authorizedClient, orgId, buildingD.id, "Delta floor 1" )

    const roomA1_1 = await createRoom( authorizedClient, orgId, floorA1.id, "Meet A1:1", 6, "a1@example.com" )
    const roomA1_2 = await createRoom( authorizedClient, orgId, floorA1.id, "Meet A1:2", 9, "a2@example.com" )
    const roomA1_3 = await createRoom( authorizedClient, orgId, floorA1.id, "Meet A1:3", 12, "a3@example.com" )
    const roomA2_1 = await createRoom( authorizedClient, orgId, floorA2.id, "Meet A2:1", 17, "a4@example.com" )
    const roomA2_2 = await createRoom( authorizedClient, orgId, floorA2.id, "Meet A2:2", 4, "a5@example.com" )

    const roomC1_1 = await createRoom( authorizedClient, orgId, floorC1.id, "Meet C1:1", 5, "c1@example.com" )

    const deskA1_1 = await createDesk( authorizedClient, orgId, floorA1.id, "Desk 246" )
    const deskA1_2 = await createDesk( authorizedClient, orgId, floorA1.id, "Desk 251" )
    const deskA1_3 = await createDesk( authorizedClient, orgId, floorA1.id, "Desk 323" )
    const deskA2_1 = await createDesk( authorizedClient, orgId, floorA2.id, "Desk 767" )
    const deskA2_2 = await createDesk( authorizedClient, orgId, floorA2.id, "Desk 666" )

    // register calendars
    if( options.calendar || options.calendarUsers || options.calendarSources ) {
        await createCalendarResources( authorizedClient, pgClient )
    }

    console.log( "\n--- All Done! ---" )
    console.log( orgId, "Organization" )
    console.log( superuser.id, "Superuser" )
    console.log( orgUser.id, "Org user" )
    await pgClient.end()
    process.exit( 0 )
}

main()
