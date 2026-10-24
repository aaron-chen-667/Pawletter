# Public pet profile records

The adopter profile now reads `GET /v1/catalog/:id/facts` instead of using fixed health, uncertainty and care placeholders.

- The endpoint permits only published, non-internal catalog pets. It reads visibility and knowledge in one SQL statement and sends `Cache-Control: no-store`.
- Returned notes come only from archived observations with `share_with_agent=true`, matching the pet agent's source eligibility. Private, withdrawn and unfinished observations are excluded. Raw audio, original submissions and transcripts are never returned.
- The frontend displays stored source statements grouped by health, household care/diet, pending confirmation and everyday observations. It preserves uncertainty and does not generate new medical conclusions. Future-household care requirements are not presented as the animal's existing abilities.
- Each profile entry, including back navigation, reloads records. Request epochs prevent an older response from replacing the current pet's records. Loading errors have a retry action and are separate from a successful empty result.

Validation on 2026-10-24: 25 backend tests passed; focused frontend tests covered grouping, escaping, network retry, empty records and refreshed records on return. The live API returned 51 eligible notes for 17 catalog pets. Browser visual verification was unavailable because the browser automation runtime could not initialize.

Deployment: Cloud Run revision `pawletter-api-facts-78965301`; Sites source `eb35b8c061e2e5402beacf7aefae21d3822cefa2`. The chat loading message was also updated to “正在翻阅宠物的档案…”.
