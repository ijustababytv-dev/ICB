# Test locations

Run `npm run test:unit` for business rules and project structure; run `npm run test:e2e` for HTTP, persistence, log-reader, and overlay integration checks. `npm test` runs both.

Unit tests use Node's built-in test runner. Tests must never import the server entry point or use live state. Every new or changed business rule needs expected and edge-case tests in `unit/`. Include a regression test for each rule fix.
