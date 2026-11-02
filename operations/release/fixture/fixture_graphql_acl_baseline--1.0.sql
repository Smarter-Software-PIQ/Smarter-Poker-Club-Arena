GRANT USAGE ON SCHEMA graphql, graphql_public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA graphql, graphql_public TO postgres WITH GRANT OPTION;
GRANT ALL ON SCHEMA graphql, graphql_public TO supabase_admin;
