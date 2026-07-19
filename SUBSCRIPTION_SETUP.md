# Subscription Setup Guide (PhonePe, Razorpay, Cashfree)

## Prerequisites
- Google Play Developer Account ($25 one-time fee)
- At least one payment gateway account (PhonePe, Razorpay, or Cashfree)

## Gateway Configuration

### 1. PhonePe

1. Register at https://www.phonepe.com/business-solutions/
2. Get your `Merchant ID` and `Salt Key` from the dashboard
3. For testing, use the sandbox environment

```bash
# .env
PHONEPE_ENV=production
PHONEPE_MERCHANT_ID=YOUR_MERCHANT_ID
PHONEPE_SALT_KEY=YOUR_SALT_KEY
PHONEPE_SALT_INDEX=1
```

### 2. Razorpay

1. Register at https://razorpay.com/
2. Get your `Key ID` and `Key Secret` from Dashboard > Settings > API Keys

```bash
# .env
RAZORPAY_KEY_ID=YOUR_KEY_ID
RAZORPAY_KEY_SECRET=YOUR_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
```

### 3. Cashfree

1. Register at https://www.cashfree.com/
2. Get your `Client ID` and `Client Secret` from Dashboard

```bash
# .env
CASHFREE_ENV=production
CASHFREE_CLIENT_ID=YOUR_CLIENT_ID
CASHFREE_CLIENT_SECRET=YOUR_CLIENT_SECRET
CASHFREE_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
```

## Environment Variables

Create a `.env` file in the `api/` directory:

```bash
# PhonePe Configuration
PHONEPE_ENV=production
PHONEPE_MERCHANT_ID=YOUR_MERCHANT_ID
PHONEPE_SALT_KEY=YOUR_SALT_KEY
PHONEPE_SALT_INDEX=1

# Razorpay Configuration
RAZORPAY_KEY_ID=YOUR_KEY_ID
RAZORPAY_KEY_SECRET=YOUR_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET

# Cashfree Configuration
CASHFREE_ENV=production
CASHFREE_CLIENT_ID=YOUR_CLIENT_ID
CASHFREE_CLIENT_SECRET=YOUR_CLIENT_SECRET
CASHFREE_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET

# Database
OCR_DB_NAME=ocr_v1_00
OCR_DB_HOST=127.0.0.1
OCR_DB_PORT=3306
OCR_DB_USER=root
OCR_DB_PASSWORD=your_password

# JWT Secret (IMPORTANT: Set a strong secret!)
JWT_SECRET=your_very_long_random_secret_here_min_32_chars
SECRET_KEY=your_very_long_random_secret_here_min_32_chars
```

## Database Migration

Run the subscription tables migration:

```bash
cd api
mysql -u root -p ocr_v1_00 < migrations/004_subscription_tables.sql
```

This creates:
- `subscription_plans` - Stores plan details
- `subscription_orders` - Tracks payment orders
- `user_subscriptions` - Active user subscriptions

## Mobile App Configuration

### Update API URL
In `app.json`, set your production API URL:

```json
{
  "expo": {
    "extra": {
      "apiBaseUrl": "https://your-api-domain.com"
    }
  }
}
```

### Install Dependencies
```bash
npm install react-native-webview
npx expo install react-native-webview
```

## API Endpoints

### PhonePe
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/subscriptions/create-order` | Initiate PhonePe payment |
| POST | `/api/subscriptions/webhook/phonepe` | PhonePe webhook handler |

### Razorpay
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/subscriptions/razorpay/create-order` | Create Razorpay order |
| POST | `/api/subscriptions/razorpay/verify-payment` | Verify & activate subscription |
| POST | `/api/subscriptions/razorpay/webhook` | Razorpay webhook |

### Cashfree
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/subscriptions/cashfree/create-order` | Create Cashfree order |
| POST | `/api/subscriptions/cashfree/verify-payment` | Verify & activate subscription |
| POST | `/api/subscriptions/cashfree/webhook` | Cashfree webhook |

### Common Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/subscriptions/plans` | List all plans |
| GET | `/api/subscriptions/status` | Get user's subscription status |
| GET | `/api/subscriptions/my` | Get user's subscription history |
| GET | `/api/subscriptions/check-payment/<order_id>` | Check payment status |
| POST | `/api/subscriptions/cancel/<id>` | Cancel subscription |

## Default Subscription Plans

| Plan | Price | Duration | Features |
|------|-------|----------|----------|
| Free | ₹0 | - | 10 scans/month, PDF export |
| Premium | ₹99 | 30 days | Unlimited scans, PDF/CSV/Excel, Cloud sync |
| Professional | ₹299 | 30 days | API access, Priority support |

## Testing

### Sandbox Testing
1. Set gateway env to sandbox/test mode
2. Use test credentials from each gateway's developer portal
3. Test payment flow end-to-end

### Test Cards
- **Razorpay**: Use test cards from https://razorpay.com/docs/payments/payments/test-card-details/
- **PhonePe**: Use test credentials from PhonePe sandbox
- **Cashfree**: Use test credentials from Cashfree sandbox

## Production Checklist

- [ ] Set all gateway environments to `production`
- [ ] Use production gateway credentials
- [ ] Enable HTTPS on API server
- [ ] Set strong `JWT_SECRET`
- [ ] Update database credentials
- [ ] Configure webhooks for all gateways
- [ ] Test payment flow with small amount
- [ ] Set up proper CORS in production
- [ ] Configure rate limiting

## Mobile App Flow

1. User selects a plan from SubscriptionPlansScreen
2. User chooses payment gateway (PhonePe/Razorpay/Cashfree)
3. App calls `create-order` endpoint for selected gateway
4. User completes payment on gateway's page/WebView
5. App verifies payment and activates subscription

## Troubleshooting

### Payment not working
1. Check gateway dashboard for transaction status
2. Verify webhook is reaching your server
3. Check server logs for errors

### Subscription not activating
1. Verify webhook signature validation
2. Check database `subscription_orders` table
3. Ensure `subscription_plans` table has valid plans

### App can't reach API
1. Check `apiBaseUrl` in `app.json`
2. Ensure HTTPS is enabled for production
3. Check CORS settings in Flask app
