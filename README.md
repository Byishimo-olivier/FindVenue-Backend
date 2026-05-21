# Smart Event Venue Backend

Express API for authentication, venue management, booking reservations, and mock payments.

## Run

```bash
npm run dev
```

The API runs on `http://localhost:4000` by default.

Optional environment variables:

```bash
PORT=4000
CLIENT_ORIGIN=http://127.0.0.1:5173
TOKEN_SECRET=replace-in-production
GOOGLE_CLIENT_ID=your-google-oauth-client-id
USE_MONGO=true # optional; otherwise local JSON files under backend/data are used
```

## Main Endpoints

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/venues`
- `GET /api/venues/:id`
- `POST /api/venues`
- `PUT /api/venues/:id`
- `DELETE /api/venues/:id`
- `GET /api/bookings/addons`
- `GET /api/bookings/availability?venueId=akagera&month=2026-10`
- `GET /api/bookings`
- `POST /api/bookings`
- `GET /api/bookings/:id`
- `PATCH /api/bookings/:id`
- `PATCH /api/bookings/:id/cancel`
- `POST /api/payments/intent`
- `POST /api/payments/:id/confirm`
- `GET /api/payments`

Protected endpoints require:

```http
Authorization: Bearer <token>
```

Data is stored in local JSON files under `backend/data` for development.
