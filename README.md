# WedPlan Server

REST API for the WedPlan wedding planning platform, built with Express and MongoDB. Requests are authenticated with JWTs issued by Better Auth in the client app, and roles are always loaded from the database.

- **Live API:** https://wedplan-server-eight.vercel.app
- **Live site:** https://wedplan-client-lime.vercel.app
- **Server repository:** https://github.com/mdraihanhossain501-cmd/wedplan-server
- **Client repository:** https://github.com/mdraihanhossain501-cmd/wedplan-client

## Features

- JWT verification against the client's JWKS, with role and blocked-user checks on every protected route
- Service management with a Free plan limit of 3 active services
- Booking rules: no booking your own service, no duplicate active bookings for the same date, only pending requests can be accepted, rejected or cancelled
- Admin moderation of users and services, plus read-only transactions
- Stripe Checkout sessions and a signature-verified webhook that activates Premium and records transactions
- Search, filter, sort and pagination on public service listings, with Premium vendors first

## Tech stack

Node.js, Express, MongoDB (official driver), jose (JWT verification), Stripe, CORS, dotenv.

## Getting started

### Prerequisites
- Node.js 20 or newer
- A MongoDB Atlas database
- The WedPlan client (it issues the login tokens)

### Install and run

```bash
git clone https://github.com/mdraihanhossain501-cmd/wedplan-server.git
cd wedplan-server
npm install
cp .env.example .env
# fill in the values in .env
npm run dev
```

The API runs at http://localhost:5000.

### Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the server in development |
| `npm run make-admin -- user@example.com` | Promote an existing user to admin |
| `node scripts/seed.js` | Add demo vendors and approved services |

Admin accounts cannot be created through sign up. Register a normal account in the client, then promote it with `make-admin`.

## Environment variables

Create `.env` with these names. Never commit real values.

| Name | Purpose |
|---|---|
| `PORT` | Port for local development |
| `CLIENT_URL` | Public URL of the client (used for CORS and Stripe redirects) |
| `MONGODB_URI` | MongoDB connection string |
| `DB_NAME` | Database name |
| `AUTH_URL` | Public URL of the client; must exactly equal the client's `BETTER_AUTH_URL` |
| `STRIPE_SECRET_KEY` | Stripe secret key (test mode) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |

## API overview

**Public**

| Method | Route | Description |
|---|---|---|
| GET | `/` | Health check |
| GET | `/api/services` | List approved, active services |

**Any signed-in user**

| Method | Route | Description |
|---|---|---|
| GET | `/api/me` | Current user |
| GET | `/api/services/:id` | Service details |
| GET | `/api/bookings/:id` | Booking details (parties only) |

**Customer**

| Method | Route | Description |
|---|---|---|
| POST | `/api/bookings` | Create a booking request |
| GET | `/api/bookings/mine` | My bookings |
| PATCH | `/api/bookings/:id/cancel` | Cancel a pending booking |
| GET | `/api/stats/customer` | Dashboard counts |

**Vendor**

| Method | Route | Description |
|---|---|---|
| GET | `/api/services/mine` | My services |
| POST | `/api/services` | Create a service |
| PUT | `/api/services/:id` | Update a service |
| PATCH | `/api/services/:id/availability` | Activate or deactivate |
| DELETE | `/api/services/:id` | Delete a service |
| GET | `/api/bookings/vendor` | Booking requests for my services |
| PATCH | `/api/bookings/:id/respond` | Accept or reject a pending request |
| GET | `/api/stats/vendor` | Dashboard counts |
| POST | `/api/payments/checkout-session` | Start Stripe Checkout |
| GET | `/api/payments/status` | Current plan status |

**Admin**

| Method | Route | Description |
|---|---|---|
| GET | `/api/admin/users` | List users |
| GET | `/api/admin/users/:id` | User details |
| PATCH | `/api/admin/users/:id/block` | Block or unblock |
| GET | `/api/admin/services` | List all services |
| PATCH | `/api/admin/services/:id/status` | Approve or reject |
| DELETE | `/api/admin/services/:id` | Delete a service |
| GET | `/api/admin/transactions` | Transactions (read-only) |
| GET | `/api/admin/stats` | Platform statistics |

**Stripe**

| Method | Route | Description |
|---|---|---|
| POST | `/api/stripe/webhook` | Verified webhook; the only place Premium is activated |

## Testing Stripe locally

```bash
stripe listen --events checkout.session.completed,invoice.paid,customer.subscription.deleted --forward-to localhost:5000/api/stripe/webhook
```

Copy the printed `whsec_...` value into `STRIPE_WEBHOOK_SECRET` and restart the server. Use test card `4242 4242 4242 4242`.

## Deployment

Deployed on Vercel using `vercel.json`. Add the environment variables above in the Vercel project settings, allow Vercel in MongoDB Atlas network access, and add a Stripe webhook destination pointing to `https://<your-server-url>/api/stripe/webhook` with the events listed above.