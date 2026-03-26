const { TableClient, odata } = require("@azure/data-tables");

const CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
const TABLE_NAME = "iplDraftState";
const PARTITION_KEY = "draft";
const ROW_KEY = "state";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } };

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    context.res.status = 204;
    context.res.body = "";
    return;
  }

  try {
    const { state } = req.body;
    if (!state) {
      context.res.status = 400;
      context.res.body = JSON.stringify({ ok: false, error: "Missing state in body" });
      return;
    }

    const client = TableClient.fromConnectionString(CONNECTION_STRING, TABLE_NAME);

    // Create table if it doesn't exist
    try { await client.createTable(); } catch (_) { /* already exists */ }

    const entity = {
      partitionKey: PARTITION_KEY,
      rowKey: ROW_KEY,
      stateJson: JSON.stringify(state),
      updatedAt: new Date().toISOString(),
    };

    await client.upsertEntity(entity, "Replace");

    context.res.body = JSON.stringify({ ok: true });
  } catch (err) {
    context.res.status = 500;
    context.res.body = JSON.stringify({ ok: false, error: err.message });
  }
};
