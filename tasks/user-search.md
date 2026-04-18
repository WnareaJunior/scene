# Add user search endpoint

Implement GET /api/v1/users/search?q= endpoint in backend/src/routes/users.js.

Requirements:
- Search by username and display_name (case insensitive)
- Require authentication via auth middleware
- Return paginated results (limit/offset)
- Exclude the requesting user from results
- Follow existing response shape in users.js
- Add input sanitization on the q parameter