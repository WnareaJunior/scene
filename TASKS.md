Micro Venue Event App - Backend Endpoints (MVP)
Authentication

POST /auth/signup — email, password, username, profile_picture, gender, bio, interests
POST /auth/login — username_or_email, password
POST /auth/logout — auth required

User Profile

GET /users/:user_id — get user profile
GET /users/me — get current authenticated user
PUT /users/:user_id — update bio, picture, interests (auth required)

Party/Event Management

POST /parties — create new party (auth required)
GET /parties — get all parties with filters (lat, long, radius, date, interests)
GET /parties/:party_id — get single party details
PUT /parties/:party_id — update party (host only, auth required)
DELETE /parties/:party_id — delete party (host only, auth required)

RSVPs

POST /parties/:party_id/rsvp — RSVP to party (auth required)
GET /parties/:party_id/attendees — get list of people attending
PUT /parties/:party_id/rsvp — update RSVP status (auth required)
DELETE /parties/:party_id/rsvp — cancel RSVP (auth required)

Social/Follow

POST /users/:user_id/follow — follow user (auth required)
DELETE /users/:user_id/follow — unfollow user (auth required)
GET /users/:user_id/following — get user's following list
GET /users/:user_id/followers — get user's followers
GET /feed/following-parties — parties your friends are attending (auth required)

Search & Discovery

GET /search/parties — search by keyword/interests with location filters
GET /parties/popular — trending parties in area
GET /parties/categories/:category — parties by interest category

Utility

GET /health — server status
GET /interests — list all available interest categories