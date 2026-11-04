# Views

There are no application views or materialized views in the deployed schema.
Reports currently use explicit SQL in `cloud-server/src/activity/reports.js`.
Add each future view as its own `.sql` file here and list it in `../schema.json`.
