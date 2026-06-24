# Vercel Deployment Guide for AMPHub

This guide details the steps required to deploy the AMPHub open-source product landing website to Vercel and configure the custom subdomain **https://amphub.itsupport.com.bd**.

---

## 1. DNS Configuration (Custom Subdomain)

To map the apex DNS zone for `itsupport.com.bd` and route the subdomain `amphub` to Vercel:

1. Log in to your DNS provider's management console (where the DNS zone for `itsupport.com.bd` is hosted).
2. Add a new **CNAME** record with the following details:
   - **Type**: `CNAME`
   - **Name (Host)**: `amphub`
   - **Value (Target)**: `cname.vercel-dns.com`
   - **TTL**: `Automatic` or `3600` (1 hour)
3. Save the DNS record. propagation may take anywhere from a few minutes to 24 hours.

---

## 2. Vercel Project Setup & Deployment

1. Sign in to your [Vercel Dashboard](https://vercel.com).
2. Click **Add New** > **Project** and import the `amphub` repository.
3. Configure the project settings:
   - **Framework Preset**: `Next.js`
   - **Root Directory**: `web-portal`
4. Add the Firebase config environment variable under **Environment Variables**:
   - **Key**: `NEXT_PUBLIC_FIREBASE_CONFIG`
   - **Value**: A JSON string containing your Firestore Web App keys:
     ```json
     {
       "apiKey": "your-api-key",
       "authDomain": "your-project-id.firebaseapp.com",
       "projectId": "your-project-id",
       "storageBucket": "your-project-id.appspot.com",
       "messagingSenderId": "your-sender-id",
       "appId": "your-app-id",
       "measurementId": "your-measurement-id"
     }
     ```
5. Click **Deploy**.

---

## 3. Map Subdomain in Vercel

1. In the Vercel project dashboard, go to **Settings** > **Domains**.
2. Add `amphub.itsupport.com.bd` to the list of domains.
3. Vercel will automatically verify the CNAME record configured in Step 1 and provision a Let's Encrypt SSL/TLS certificate for secure HTTPS access.
