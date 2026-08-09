const { Pool } = require('pg');

const pool = new Pool({ connectionString: 'postgresql://sagitta:sagitta_pw@127.0.0.1:5432/sagitta_banking' });

async function run() {
  const res = await pool.query(`
    UPDATE term_positions
    SET term_maturity_at = NOW() - INTERVAL '1 day'
    WHERE id = 'b33fc7c7-0496-4f0c-92bf-98e03c499a29'
    RETURNING id, term_maturity_at
  `);
  console.log('Updated:', res.rows[0]);
  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
