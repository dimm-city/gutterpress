# Introduction

Welcome to the API Documentation Guide. This document provides comprehensive information about our REST API, including authentication, endpoints, and best practices.

## Overview

Our API provides programmatic access to all platform features:

- **User Management** - Create and manage user accounts
- **Data Operations** - CRUD operations on resources
- **Analytics** - Access usage metrics and reports
- **Webhooks** - Real-time event notifications

## API Version

Current version: **v2.0**

Base URL: `https://api.example.com/v2`

## Support

- **Email:** api-support@example.com
- **Documentation:** https://docs.example.com
- **Status Page:** https://status.example.com

@break

## Quick Start

```javascript
// Initialize the client
const client = new APIClient({
  apiKey: 'your-api-key',
  baseURL: 'https://api.example.com/v2'
});

// Fetch user data
const user = await client.users.get('user-123');
console.log(user);
```

## Rate Limits

| Plan       | Requests/hour | Burst  |
|------------|---------------|--------|
| Free       | 100           | 10/min |
| Basic      | 1,000         | 50/min |
| Pro        | 10,000        | 100/min|
| Enterprise | Unlimited     | Custom |
