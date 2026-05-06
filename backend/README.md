# hector.golf backend

This is an Express.js based REST API for the hector.golf website.

# GeneratePlayerAvatar API

`GeneratePlayerAvatar` expects a JSON body with two fields:

- `photo`: source image of the player
- `sample`: style reference image

Each image field can be provided as one of:

- non-empty base64 string
- non-empty data URL string (for example `data:image/png;base64,...`)
- object with `data` or `base64`
- object with `inlineData` containing both `data` and `mimeType`

If either field is invalid, the function responds with HTTP `400` and a `details` array that explains validation errors.

## Example request (data URL strings)

For example, when the function is deployed to `https://europe-north1-gen-lang-client-0537211409.cloudfunctions.net/GeneratePlayerAvatar`:

```bash
curl -X POST "https://europe-north1-gen-lang-client-0537211409.cloudfunctions.net/GeneratePlayerAvatar" \
    -H "Authorization: Bearer <ASTROSITE_API_KEY>" \
    -H "Content-Type: application/json" \
    -d '{
        "photo": "data:image/jpeg;base64,/9j/4AAQSk...",
        "sample": "data:image/png;base64,iVBORw0KGgo..."
    }'
```

## Example request (inlineData objects)

```bash
curl -X POST "https://europe-north1-gen-lang-client-0537211409.cloudfunctions.net/GeneratePlayerAvatar" \
    -H "Authorization: Bearer <ASTROSITE_API_KEY>" \
    -H "Content-Type: application/json" \
    -d '{
        "photo": {
            "inlineData": {
                "mimeType": "image/jpeg",
                "data": "/9j/4AAQSk..."
            }
        },
        "sample": {
            "inlineData": {
                "mimeType": "image/png",
                "data": "iVBORw0KGgo..."
            }
        }
    }'
```

## Example success response

```json
{
    "avatar": "iVBORw0KGgoAAAANSUhEUgAA...",
    "mimeType": "image/png"
}
```

## Example validation error response

```json
{
    "error": "Invalid payload",
    "message": "Expected a JSON body with valid photo and sample image payloads.",
    "details": [
        "photo.inlineData.mimeType must be a non-empty string.",
        "sample object must include one of: data, base64, or inlineData."
    ]
}
```

# Local CLI For GeneratePlayerAvatar

From [backend/backend-functions](backend/backend-functions), run:

```bash
npm run cli:generate-player-avatar -- <photo-file> <sample-file> [output-file]
```

Example:

```bash
cd backend/backend-functions
npm run cli:generate-player-avatar -- ../samples/player.jpg ../samples/style.png ./generated-avatar.png
```

Notes:

- The CLI loads environment variables from `.env` automatically.
- It uses `ASTROSITE_API_KEY` for authentication.
- It uses `GENERATE_PLAYER_AVATAR_URL` if set.
- If `GENERATE_PLAYER_AVATAR_URL` is not set, it builds the URL from `FUNCTION_REGION` and `GCLOUD_PROJECT_ID`.
- The generated image is written to `[output-file]` (defaults to `generated-avatar.png`).
