# API Endpoints

Complete reference for all available endpoints.

## Users

### Get Current User

```http
GET /users/me
```

**Response:**

```json
{
  "status": "success",
  "data": {
    "id": "user-123",
    "name": "John Doe",
    "email": "john@example.com",
    "plan": "pro",
    "createdAt": "2025-01-15T10:30:00Z"
  }
}
```

### Get User by ID

```http
GET /users/:id
```

**Parameters:**

| Name | Type   | Required | Description       |
|------|--------|----------|-------------------|
| id   | string | Yes      | User ID           |

**Example:**

```bash
curl https://api.example.com/v2/users/user-123 \
  -H "Authorization: Bearer YOUR_API_KEY"
```

@break

### Create User

```http
POST /users
```

**Request Body:**

```json
{
  "name": "Jane Smith",
  "email": "jane@example.com",
  "role": "member"
}
```

**Response:**

```json
{
  "status": "success",
  "data": {
    "id": "user-456",
    "name": "Jane Smith",
    "email": "jane@example.com",
    "role": "member",
    "createdAt": "2025-11-19T12:00:00Z"
  }
}
```

### Update User

```http
PATCH /users/:id
```

**Request Body:**

```json
{
  "name": "Jane Doe",
  "role": "admin"
}
```

### Delete User

```http
DELETE /users/:id
```

**Response:**

```json
{
  "status": "success",
  "data": {
    "id": "user-456",
    "deleted": true
  }
}
```

@break

## Data Operations

### List Resources

```http
GET /resources
```

**Query Parameters:**

| Name     | Type    | Default | Description              |
|----------|---------|---------|--------------------------|
| page     | integer | 1       | Page number              |
| per_page | integer | 20      | Items per page (max 100) |
| sort     | string  | -created| Sort field and direction |
| filter   | string  | -       | Filter expression        |

**Example:**

```bash
curl 'https://api.example.com/v2/resources?page=1&per_page=50&sort=-created' \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**Response:**

```json
{
  "status": "success",
  "data": [
    {
      "id": "res-123",
      "name": "Resource 1",
      "created": "2025-11-19T12:00:00Z"
    }
  ],
  "meta": {
    "page": 1,
    "per_page": 50,
    "total": 100,
    "pages": 2
  }
}
```

## Webhooks

### Create Webhook

```http
POST /webhooks
```

**Request Body:**

```json
{
  "url": "https://example.com/webhook",
  "events": ["user.created", "user.updated"],
  "secret": "whsec_abc123"
}
```

**Webhook Payload:**

```json
{
  "id": "evt-789",
  "type": "user.created",
  "data": {
    "id": "user-456",
    "name": "Jane Smith"
  },
  "created": "2025-11-19T12:00:00Z"
}
```
