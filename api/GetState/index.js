const { TableClient } = require("@azure/data-tables");

const CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
const TABLE_NAME = "iplDraftState";
const PARTITION_KEY = "draft";
const ROW_KEY = "state";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } };

  try {
    const client = TableClient.fromConnectionString(CONNECTION_STRING, TABLE_NAME);

    try {
      const entity = await client.getEntity(PARTITION_KEY, ROW_KEY);
      const state = JSON.parse(entity.stateJson);
      context.res.body = JSON.stringify({ ok: true, state });
    } catch (e) {
      // Entity doesn't exist yet — return null so frontend creates fresh state
      context.res.body = JSON.stringify({ ok: true, state: null });
    }
  } catch (err) {
    context.res.status = 500;
    context.res.body = JSON.stringify({ ok: false, error: err.message });
  }
};
