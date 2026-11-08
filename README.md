# Vignan Cafeteria

A responsive cafeteria ordering application with a React frontend, Flask REST API, and MongoDB Atlas storage.

## Requirements

- Python 3.10+
- Node.js 18+
- MongoDB Atlas database (or local MongoDB)

## Run the backend

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
# Set MONGO_URI and a long, random JWT_SECRET in .env
python run.py
```

The API starts at `http://localhost:5000`. On startup it creates useful indexes and seeds sample food and categories if the database is empty. Customers register and log in with their name and student register number; there are no password or email fields in that flow. To create an admin, register the account and set its `role` to `admin` in the MongoDB `users` collection. Admin role is never accepted from public registration. Existing accounts from the earlier email/password version need a `register_number` value added in MongoDB before they can use the new login.

## Run the frontend

```powershell
cd frontend
npm install
npm run dev
```

The Vite development server runs at `http://localhost:5173` and proxies `/api` requests to the Flask backend at `http://127.0.0.1:5000`. Set `VITE_API_URL` in `frontend/.env` only when the API is hosted elsewhere; the default is `/api`.

## MongoDB Atlas

Create a database and database user in Atlas, allow the app host in Network Access, and copy the connection string into `backend/.env` as `MONGO_URI`. The backend selects the database named by `MONGO_DB_NAME`, even when the URI has no database path. Never put the URI in frontend configuration. Collections are created on first use: `users`, `categories`, `foods`, `carts`, `orders`, and `contact_messages`.

## Deploy with Vercel and Render

1. Deploy the backend to Render using the repository's `render.yaml` blueprint. Set `MONGO_URI` to the MongoDB Atlas connection string and `FRONTEND_ORIGIN` to the deployed Vercel origin (for example, `https://your-app.vercel.app`). Render generates `JWT_SECRET`; keep it private. The service health check is `/api/health`.
2. Create a Vercel project from this repository and set its **Root Directory** to `frontend`. Use the Vite preset, build command `npm run build`, and output directory `dist`.
3. In the Vercel project's environment variables, set `VITE_API_URL` to the Render service URL followed by `/api` (for example, `https://your-api.onrender.com/api`). Set it for each environment you deploy, then redeploy so the value is included in the frontend build.
4. If the Vercel domain changes, update Render's `FRONTEND_ORIGIN` to match it. Do not put `MONGO_URI` or `JWT_SECRET` in Vercel variables.

## Main API routes

- `POST /api/auth/register` (name, register number, optional phone), `POST /api/auth/login` (name and register number), `POST /api/auth/logout`, `GET/PATCH /api/auth/profile`
- `GET /api/foods`, `GET /api/foods/:id`; admin CRUD at `/api/admin/foods`
- `GET/POST /api/cart`, `PATCH/DELETE /api/cart/:food_id`, `DELETE /api/cart`
- `POST /api/orders`, `GET /api/orders`, `GET /api/admin/orders`, `PATCH /api/admin/orders/:id/status`
- Admin stats and customer/category management under `/api/admin`
- `POST /api/contact`

All admin routes require a JWT belonging to an admin. Orders use server-side food prices and verify customer ownership. Payments are recorded as a selected payment method/status; this app does not integrate a payment processor.

## Verification

Run backend checks with `python -m compileall backend` and frontend production build with `npm run build` from `frontend` after installing dependencies. API functionality requires a reachable MongoDB instance and configured secrets.
