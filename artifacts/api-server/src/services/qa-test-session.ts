export const INSERT_QA_TEST_SESSION_SQL = `
  INSERT INTO user_sessions (token, user_id, org_id, email, role, expires_at, created_at, user_id_v2)
  VALUES ($1::text, $2::text, $3::text, 'qa@flowpoint.pro', $4::text, $5::timestamptz, NOW(), $6::uuid)
`;
