# Authentication

All API requests require authentication using an API key.

## API Keys

### Obtaining Your API Key

1. Log in to your dashboard
2. Navigate to **Settings → API Keys**
3. Click **Generate New Key**
4. Copy and store your key securely

> **Security Warning:** Never commit API keys to version control or share them publicly.

### Using Your API Key

Include your API key in the `Authorization` header:

```
Authorization: Bearer YOUR_API_KEY
```

### Example

```bash
curl https://api.example.com/v2/users/me \
  -H "Authorization: Bearer sk_live_abc123def456"
```

@break

## Key Types

| Type        | Prefix    | Use Case                          |
|-------------|-----------|-----------------------------------|
| Test        | `sk_test_`| Development and testing           |
| Production  | `sk_live_`| Production environments           |
| Restricted  | `sk_rest_`| Limited scope for specific tasks  |

## Key Rotation

Rotate your API keys regularly for security:

```javascript
// Generate new key via API
const newKey = await client.keys.create({
  name: 'Production Key 2025',
  scopes: ['users:read', 'users:write']
});

// Update your application
process.env.API_KEY = newKey.key;

// Revoke old key after verification
await client.keys.revoke(oldKeyId);
```

## Permissions & Scopes

Restrict key permissions using scopes:

```json
{
  "scopes": [
    "users:read",
    "users:write",
    "analytics:read"
  ]
}
```

Available scopes:

- `users:read` - Read user data
- `users:write` - Create/update users
- `data:read` - Read application data
- `data:write` - Modify application data
- `analytics:read` - Access analytics
- `webhooks:manage` - Manage webhooks
