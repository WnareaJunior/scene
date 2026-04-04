# Scene

A location-based event discovery platform that connects micro-venue hosts and independent artists with local audiences. Find, create, and RSVP to events near you through an intuitive map-based interface.

## Features (MVP)

- **User Authentication** - Sign up with email/password, optional profile customization (bio, interests, gender, profile picture)
- **Event Discovery** - Browse parties on an interactive map, filter by location, time, and genre
- **Event Creation** - Host your own parties with capacity limits, time, location, and description
- **Social Integration** - Follow other users, see which friends are attending events, discover events from your network
- **RSVP System** - Mark attendance status (going, interested, maybe), view attendee lists, enforce capacity limits

## Tech Stack

- **Frontend:** React Native (cross-platform iOS/Android)
- **Backend:** Node.js + Express
- **Database:** PostgreSQL
- **Authentication:** JWT (JSON Web Tokens)
- **Geolocation:** Latitude/Longitude based queries

## Getting Started

### Prerequisites
- Node.js v16+
- PostgreSQL
- React Native CLI
- npm or yarn

### Installation

#### Backend Setup
```bash
git clone [repo-url]
cd backend
npm install
cp .env.example .env
# Configure DATABASE_URL, JWT_SECRET, etc.
npm run dev
```

#### Frontend Setup
```bash
cd frontend
npm install
npx react-native run-ios   # or run-android
```

### Environment Variables

Backend (.env):
```
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
JWT_SECRET=your-secret-key
NODE_ENV=development
PORT=5000
```

## API Documentation

See `BACKEND_ENDPOINTS.md` for complete endpoint specification.

## Project Structure
```
.
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── models/
│   │   ├── middleware/
│   │   └── app.js
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── screens/
│   │   ├── components/
│   │   ├── navigation/
│   │   └── App.js
│   └── package.json
└── README.md
```

## License

GNU Affero General Public License v3.0 - See LICENSE file for details

## Contributing

This project is closed-source. For inquiries, contact [wilsondev27@outlook.com].
