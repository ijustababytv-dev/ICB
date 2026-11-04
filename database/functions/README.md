# Functions and procedures

There are no application stored functions or procedures in the deployed schema.
Business rules currently run in the Node services. Add each future stored routine
as its own `.sql` file here and list it in `../schema.json`. Anonymous bootstrap
`DO` blocks belong to their role files and are not stored functions.
