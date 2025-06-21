# Firestore Direct Logging Setup

This setup allows your proxy to log directly to Firestore without needing Cloud Functions.

## Step 1: Create Firestore Database

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **Firestore Database** (in the left menu under "Databases")
3. Click **"Create Database"**
4. Choose **"Start in test mode"** (for development)
5. Select a location (choose one close to you)
6. Click **"Done"**

## Step 2: Set Up Authentication

### Option A: Service Account (Recommended for Vercel)

1. Go to **IAM & Admin** > **Service Accounts**
2. Click **"Create Service Account"**
3. Give it a name like "firestore-logger"
4. Click **"Create and Continue"**
5. Add these roles:
   - **Cloud Datastore User**
   - **Firebase Admin**
6. Click **"Done"**
7. Click on your new service account
8. Go to **"Keys"** tab
9. Click **"Add Key"** > **"Create new key"**
10. Choose **JSON** format
11. Download the JSON file

### Option B: Application Default Credentials (Local Development)

If you have `gcloud` CLI installed:

```bash
gcloud auth application-default login
```

## Step 3: Configure Environment Variables

### For Vercel Deployment:

1. Go to your Vercel project settings
2. Add these environment variables:
   - `GOOGLE_APPLICATION_CREDENTIALS_JSON`: Paste the entire content of your service account JSON file

### For Local Development:

1. Set the `GOOGLE_APPLICATION_CREDENTIALS` environment variable to point to your JSON file:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/service-account-key.json"
   ```

## Step 4: Deploy

1. Install dependencies:

   ```bash
   npm install
   ```

2. Deploy to Vercel:
   ```bash
   vercel --prod
   ```

## Step 5: Test

Your proxy will now automatically log all API interactions to Firestore in the `api_logs` collection.

## Viewing Logs

You can view your logs in:

1. **Firestore Console**: Go to Firestore Database > Data tab
2. **Using the analysis script**: Run `node analyze-firestore.js`

## Security Rules (Optional)

For production, you should set up Firestore security rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /api_logs/{document} {
      allow read, write: if request.auth != null;
    }
  }
}
```

## Cost

- **Free tier**: 1GB storage, 50,000 reads/day, 20,000 writes/day
- **Typical usage**: Should remain free for logging purposes
