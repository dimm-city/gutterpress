# Getting Started

This guide will help you make your first API request in just a few minutes.

## Prerequisites

- Active account with API access enabled
- API key (available in dashboard settings)
- HTTP client (curl, Postman, or programming language of choice)

## Installation

### Node.js

```bash
npm install @example/api-client
```

### Python

```bash
pip install example-api-client
```

### cURL

No installation needed - use your system's curl command.

@break

## Your First Request

### Using cURL

```bash
curl -X GET https://api.example.com/v2/users/me \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json"
```

### Using Node.js

```javascript
const { APIClient } = require('@example/api-client');

const client = new APIClient({
  apiKey: process.env.API_KEY
});

async function getProfile() {
  try {
    const profile = await client.users.me();
    console.log('User profile:', profile);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

getProfile();
```

### Using Python

```python
from example_api import APIClient

client = APIClient(api_key='YOUR_API_KEY')

try:
    profile = client.users.me()
    print(f"User profile: {profile}")
except Exception as e:
    print(f"Error: {e}")
```

## Response Format

All API responses follow this format:

```json
{
  "status": "success",
  "data": {
    "id": "user-123",
    "name": "John Doe",
    "email": "john@example.com"
  },
  "meta": {
    "timestamp": "2025-11-19T12:00:00Z",
    "requestId": "req-456"
  }
}
```

## Error Handling

Errors include detailed information:

```json
{
  "status": "error",
  "error": {
    "code": "INVALID_API_KEY",
    "message": "The provided API key is invalid or expired",
    "details": {
      "suggestion": "Check your API key in dashboard settings"
    }
  }
}
```
