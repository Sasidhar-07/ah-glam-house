# AH Glam House — Premium Full-Stack Website

A production-ready starter website for AH Glam House with a premium rose-gold/champagne visual identity, real appointment storage, protected admin dashboard, live admin notifications, click-to-call and WhatsApp contact.

## What changed in this premium version
- Replaced the supplied poster/service-card images with a logo-only visual system.
- Added a luxury editorial layout, responsive navigation, service cards, signature brand section and refined booking experience.
- The supplied AH Glam House logo is used as the main visual asset.
- No client poster artwork is shown as a gallery/service image.

## Backend
- Node.js + Express
- SQLite database
- Admin authentication with bcrypt + JWT
- Appointment CRUD/status management
- Server-sent live booking notifications for the admin dashboard
- Rate limiting and basic input validation
- Optional SMTP email and Twilio WhatsApp notifications

## Run locally
1. Install Node.js 20+.
2. `npm install`
3. Copy `.env.example` to `.env` and change the admin credentials and JWT secret.
4. `npm start`
5. Open `http://localhost:3000`
6. Admin dashboard: `http://localhost:3000/admin`

Default credentials are only development defaults. Change them before deployment.

## Real notifications
The booking is always saved to SQLite. Optional salon notifications can be enabled with SMTP and/or Twilio WhatsApp credentials in `.env`. Do not commit `.env` to GitHub.

## Deployment
For production, use a persistent server/volume for SQLite or replace SQLite with a managed database such as PostgreSQL. Use HTTPS and strong secrets. On platforms with ephemeral filesystems, SQLite will not persist across redeploys unless persistent storage is configured.
