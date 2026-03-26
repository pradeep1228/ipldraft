# 🏏 IPL Snake Draft — Azure Deployment Guide

## Architecture Overview

```
Your Friends' Browsers
        │
        ▼
Azure Static Web Apps        ← hosts the React frontend (FREE tier)
        │
        ▼
Azure Functions (Node.js)    ← GetState / SetState API endpoints
        │
        ▼
Azure Table Storage          ← stores draft state as JSON (~$0.00/month)
```

Participants poll `/api/GetState` every 2.5 seconds.  
Any action (pick, add player, start draft) calls `/api/SetState`.  
All state is one JSON blob in Azure Table Storage.

---

## Prerequisites

Install these tools first:

| Tool | Download |
|------|----------|
| Node.js 18+ | https://nodejs.org |
| Azure CLI | https://aka.ms/installazurecliwindows |
| Azure Functions Core Tools v4 | `npm install -g azure-functions-core-tools@4 --unsafe-perm true` |
| Azure Static Web Apps CLI | `npm install -g @azure/static-web-apps-cli` |

---

## Step 1 — Create Azure Resources

### 1a. Login to Azure

```bash
az login
```

### 1b. Create a Resource Group

```bash
az group create \
  --name ipl-draft-rg \
  --location eastus
```

### 1c. Create a Storage Account

```bash
az storage account create \
  --name ipldraftstorage \
  --resource-group ipl-draft-rg \
  --location eastus \
  --sku Standard_LRS
```

> ⚠️ Storage account names must be globally unique and lowercase only.  
> Change `ipldraftstorage` to something like `ipldraft2025xyz` if taken.

### 1d. Get the Storage Connection String

```bash
az storage account show-connection-string \
  --name ipldraftstorage \
  --resource-group ipl-draft-rg \
  --query connectionString \
  --output tsv
```

**Copy this value** — you'll need it in Step 3.

---

## Step 2 — Deploy the Azure Functions

### 2a. Create a Function App

```bash
az functionapp create \
  --resource-group ipl-draft-rg \
  --consumption-plan-location eastus \
  --runtime node \
  --runtime-version 18 \
  --functions-version 4 \
  --name ipl-draft-api \
  --storage-account ipldraftstorage \
  --os-type Linux
```

### 2b. Set the Storage Connection String as an App Setting

```bash
az functionapp config appsettings set \
  --name ipl-draft-api \
  --resource-group ipl-draft-rg \
  --settings AZURE_STORAGE_CONNECTION_STRING="YOUR_CONNECTION_STRING_HERE"
```

Replace `YOUR_CONNECTION_STRING_HERE` with the string you copied in Step 1d.

### 2c. Install dependencies and deploy the API

```bash
cd api
npm install
func azure functionapp publish ipl-draft-api
```

### 2d. Note your API URL

After deployment you'll see output like:

```
Functions in ipl-draft-api:
  GetState - [httpTrigger]  https://ipl-draft-api.azurewebsites.net/api/GetState
  SetState - [httpTrigger]  https://ipl-draft-api.azurewebsites.net/api/SetState
```

---

## Step 3 — Deploy the Frontend (Azure Static Web Apps)

### Option A: Deploy via GitHub (recommended)

1. Push this entire project to a GitHub repository.

2. In the Azure Portal (portal.azure.com):
   - Search for **Static Web Apps** → Create
   - Resource Group: `ipl-draft-rg`
   - Name: `ipl-snake-draft`
   - Plan type: **Free**
   - Region: East US 2
   - Source: **GitHub** → select your repo
   - Build Presets: **React**
   - App location: `/frontend`
   - Api location: `/api`
   - Output location: `dist`

3. Azure will automatically set up a GitHub Actions workflow that deploys on every push.

### Option B: Deploy via CLI (no GitHub needed)

```bash
cd frontend
npm install
npm run build

swa deploy ./dist \
  --deployment-token YOUR_SWA_DEPLOYMENT_TOKEN \
  --env production
```

Get the deployment token from the Azure Portal under your Static Web App → **Manage deployment token**.

---

## Step 4 — Configure CORS (if needed)

If you see CORS errors in the browser console, run:

```bash
az functionapp cors add \
  --name ipl-draft-api \
  --resource-group ipl-draft-rg \
  --allowed-origins "https://YOUR-APP-NAME.azurestaticapps.net"
```

Replace with your actual Static Web App URL.

---

## Step 5 — Test Locally Before Deploying

Run both the frontend and API locally to test everything first.

### Terminal 1 — Start the Azure Functions

```bash
cd api
npm install
func start
# Functions will run at http://localhost:7071/api/
```

### Terminal 2 — Start the React frontend

```bash
cd frontend
npm install
npm run dev
# App will run at http://localhost:5173
# Vite proxies /api/* to http://localhost:7071 automatically
```

Open http://localhost:5173 and test the full draft flow.

---

## Project File Structure

```
ipl-draft/
├── frontend/                    ← React app (Vite)
│   ├── src/
│   │   ├── App.jsx              ← Main app with Azure API calls
│   │   └── main.jsx             ← React entry point
│   ├── index.html
│   ├── vite.config.js           ← Dev proxy config
│   ├── package.json
│   └── staticwebapp.config.json ← Azure SWA routing rules
│
└── api/                         ← Azure Functions
    ├── GetState/
    │   ├── index.js             ← Reads state from Table Storage
    │   └── function.json        ← HTTP trigger binding
    ├── SetState/
    │   ├── index.js             ← Writes state to Table Storage
    │   └── function.json        ← HTTP trigger binding
    ├── host.json
    ├── local.settings.json      ← Local dev config (DO NOT commit)
    └── package.json
```

---

## How Live Sync Works

```
Host makes a change (adds player, starts draft)
        │
        ▼
React calls POST /api/SetState  →  Azure Function writes JSON to Table Storage
        
Meanwhile, all participants poll every 2.5 seconds:
        │
        ▼
React calls GET /api/GetState  →  Azure Function reads JSON from Table Storage
        │
        ▼
UI updates with latest state
```

**Maximum lag:** ~2.5 seconds — plenty fast for a draft!

---

## Estimated Costs

| Service | Free Tier | Typical Usage |
|---------|-----------|---------------|
| Azure Static Web Apps | Free (100GB bandwidth) | **$0/month** |
| Azure Functions | 1M free executions/month | **$0/month** |
| Azure Table Storage | Pay per GB | **~$0.01/month** |

**Total: essentially free for casual use.**

---

## Sharing with Friends

Once deployed, your app URL will look like:
```
https://ipl-snake-draft.azurestaticapps.net
```

Share this URL with all participants. The host opens it first to set up players and generate participant codes, then shares those codes with each person.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Sync error" badge in app | Check Azure Function logs in portal |
| CORS errors in console | Run the CORS step in Step 4 |
| "Storage account name taken" | Choose a different unique name |
| Functions not deploying | Ensure `func` CLI v4 is installed |
| Blank page after deploy | Check that App location is set to `/frontend` in SWA config |

---

## Security Note

This app uses shared secret codes for access (not Azure AD auth).  
For a private draft, keep your host code secret and only share participant codes with the right people.

For production use, you can add Azure AD B2C authentication via the `staticwebapp.config.json` — let me know if you'd like that added!
