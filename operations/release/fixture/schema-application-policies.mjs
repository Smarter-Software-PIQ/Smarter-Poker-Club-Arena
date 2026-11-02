import { createHash } from 'node:crypto';

// Eleven maintained application policies on the genuine service-owned table.
// Protected CREATE/ALTER sources independently recreated these exact PG17 dump
// blocks; bounded production policy metadata matched every command/role/expression.
// No caller policy list, SQL normalization or unknown managed fallback is accepted.
const witnesses = [
  {
    "schema_name": "realtime",
    "relation_name": "messages",
    "policy_name": "authorized staff receive player history signals",
    "owner": "supabase_realtime_admin",
    "command": "r",
    "permissive": true,
    "roles": [
      "authenticated"
    ],
    "definition": "CREATE POLICY \"authorized staff receive player history signals\" ON \"realtime\".\"messages\" FOR SELECT TO \"authenticated\" USING (((\"extension\" = 'broadcast'::\"text\") AND (\"topic\" = \"realtime\".\"topic\"()) AND (EXISTS ( SELECT 1\n   FROM ( SELECT\n                CASE\n                    WHEN (\"realtime\".\"topic\"() ~ '^player-history:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::\"text\") THEN (\"split_part\"(\"realtime\".\"topic\"(), ':'::\"text\", 2))::\"uuid\"\n                    ELSE NULL::\"uuid\"\n                END AS \"club_id\") \"topic\"\n  WHERE \"public\".\"ca_player_history_can_read\"(\"topic\".\"club_id\")))));",
    "block": "-- Name: messages authorized staff receive player history signals; Type: POLICY; Schema: realtime; Owner: supabase_realtime_admin\n--\n\nCREATE POLICY \"authorized staff receive player history signals\" ON \"realtime\".\"messages\" FOR SELECT TO \"authenticated\" USING (((\"extension\" = 'broadcast'::\"text\") AND (\"topic\" = \"realtime\".\"topic\"()) AND (EXISTS ( SELECT 1\n   FROM ( SELECT\n                CASE\n                    WHEN (\"realtime\".\"topic\"() ~ '^player-history:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::\"text\") THEN (\"split_part\"(\"realtime\".\"topic\"(), ':'::\"text\", 2))::\"uuid\"\n                    ELSE NULL::\"uuid\"\n                END AS \"club_id\") \"topic\"\n  WHERE \"public\".\"ca_player_history_can_read\"(\"topic\".\"club_id\")))));\n\n\n--\n",
    "block_sha256": "afaa7516e20b12e085906a313a149f952f5ca434edf334b8085a4df5dc0ae6c6",
    "sources": [
      {
        "path": "supabase/migrations/20261012144105_player_command_history_reads_sanitized_staff_scope.sql",
        "sha256": "afc0c6ef83193cc42505e9fff60a5a68373c7f9416414a035f80ef7026844e64",
        "statement_sha256": "46b1d10586c5526e41c777caa27343ebf27c33772e87506959d97781d0f44bc6",
        "kind": "protected-policy-create"
      },
      {
        "path": "supabase/migrations/20261012220618_player_history_authorizes_realtime_join_check_rows.sql",
        "sha256": "5c587f0f0f3c5508c1204d35871586dfef3fdcff0562ab9438d31814726580d2",
        "statement_sha256": "67a16ecbff01ce3b2bd9922b516c0fd7d528d230f2733f1f4e56ef95dc2a1e7d",
        "kind": "protected-policy-alter"
      }
    ]
  },
  {
    "schema_name": "realtime",
    "relation_name": "messages",
    "policy_name": "authorized viewers receive club roster changes",
    "owner": "supabase_realtime_admin",
    "command": "r",
    "permissive": true,
    "roles": [
      "authenticated"
    ],
    "definition": "CREATE POLICY \"authorized viewers receive club roster changes\" ON \"realtime\".\"messages\" FOR SELECT TO \"authenticated\" USING (((\"extension\" = 'broadcast'::\"text\") AND (\"topic\" = \"realtime\".\"topic\"()) AND \"public\".\"ca_club_roster_can_subscribe\"(\"topic\")));",
    "block": "-- Name: messages authorized viewers receive club roster changes; Type: POLICY; Schema: realtime; Owner: supabase_realtime_admin\n--\n\nCREATE POLICY \"authorized viewers receive club roster changes\" ON \"realtime\".\"messages\" FOR SELECT TO \"authenticated\" USING (((\"extension\" = 'broadcast'::\"text\") AND (\"topic\" = \"realtime\".\"topic\"()) AND \"public\".\"ca_club_roster_can_subscribe\"(\"topic\")));\n\n\n--\n",
    "block_sha256": "408fc9eca4f9f4e266b63082ce426d80ea96deb548ed822b4c0b09c9d907fb95",
    "sources": [
      {
        "path": "supabase/migrations/20261018230227_member_roster_funded_counts_and_private_source_events.sql",
        "sha256": "c6a41ea92211e4b32fcee2364fcd3b81cd0382e9ccb925bd94b7fba433000138",
        "statement_sha256": "462d3e34dd8cfd5d9078b61e09d5b82ef7902da348fe3ae2b9771818e401f3e8",
        "kind": "protected-policy-create"
      }
    ]
  },
  {
    "schema_name": "realtime",
    "relation_name": "messages",
    "policy_name": "authorized viewers receive member record changes",
    "owner": "supabase_realtime_admin",
    "command": "r",
    "permissive": true,
    "roles": [
      "authenticated"
    ],
    "definition": "CREATE POLICY \"authorized viewers receive member record changes\" ON \"realtime\".\"messages\" FOR SELECT TO \"authenticated\" USING (((\"extension\" = 'broadcast'::\"text\") AND (\"topic\" = \"realtime\".\"topic\"()) AND \"public\".\"ca_member_record_can_subscribe\"(\"topic\")));",
    "block": "-- Name: messages authorized viewers receive member record changes; Type: POLICY; Schema: realtime; Owner: supabase_realtime_admin\n--\n\nCREATE POLICY \"authorized viewers receive member record changes\" ON \"realtime\".\"messages\" FOR SELECT TO \"authenticated\" USING (((\"extension\" = 'broadcast'::\"text\") AND (\"topic\" = \"realtime\".\"topic\"()) AND \"public\".\"ca_member_record_can_subscribe\"(\"topic\")));\n\n\n--\n",
    "block_sha256": "a285eebd3319051b6f25700e34f88c75d4e5482461fa48351a7d9fc885762aea",
    "sources": [
      {
        "path": "supabase/migrations/20261018135655_member_records_follow_funded_hand_clubs_and_live_source_chan.sql",
        "sha256": "a4d8c269748f433533c2602a7574ab54495b5b6f80c0987d180dd7f2d2d8f87e",
        "statement_sha256": "aa629b6478b9e0669f728ed20c3797332107b2d5acd0de5e6a5d123c107618c6",
        "kind": "protected-policy-create"
      },
      {
        "path": "supabase/migrations/20261018183507_member_record_private_joins_authorize_the_provider_probe.sql",
        "sha256": "b89a68ff2c408400d7ce8c3c30593462d40be0bef138f26611b6b56c450e8c18",
        "statement_sha256": "3264f1022944d19bb1e9920817edefbbe401af2d75d55a48bd9b66bcf7078ab2",
        "kind": "protected-policy-alter"
      }
    ]
  },
  {
    "schema_name": "realtime",
    "relation_name": "messages",
    "policy_name": "ca_native_alert_no_client_send",
    "owner": "supabase_realtime_admin",
    "command": "a",
    "permissive": false,
    "roles": [
      "anon",
      "authenticated"
    ],
    "definition": "CREATE POLICY \"ca_native_alert_no_client_send\" ON \"realtime\".\"messages\" AS RESTRICTIVE FOR INSERT TO \"anon\", \"authenticated\" WITH CHECK ((\"left\"(COALESCE(\"realtime\".\"topic\"(), ''::\"text\"), \"length\"('ca-native-alert-intake-v1:'::\"text\")) <> 'ca-native-alert-intake-v1:'::\"text\"));",
    "block": "-- Name: messages ca_native_alert_no_client_send; Type: POLICY; Schema: realtime; Owner: supabase_realtime_admin\n--\n\nCREATE POLICY \"ca_native_alert_no_client_send\" ON \"realtime\".\"messages\" AS RESTRICTIVE FOR INSERT TO \"anon\", \"authenticated\" WITH CHECK ((\"left\"(COALESCE(\"realtime\".\"topic\"(), ''::\"text\"), \"length\"('ca-native-alert-intake-v1:'::\"text\")) <> 'ca-native-alert-intake-v1:'::\"text\"));\n\n\n--\n",
    "block_sha256": "d5b9e4e7dc96c177f01c8bbb5463e3e492c4f44347a2e6eb3de9e7065278d134",
    "sources": [
      {
        "path": "supabase/migrations/20261027175950_native_alert_event_delivery.sql",
        "sha256": "462fe3433ede05af215c326d8c4772907f8b375ad04ab958b4cbee68f0948cc0",
        "statement_sha256": "9a335545306392f168d2781e71f7eea11f6103a35a5148992c684ce88e5102c6",
        "kind": "protected-policy-create"
      }
    ]
  },
  {
    "schema_name": "realtime",
    "relation_name": "messages",
    "policy_name": "ca_native_alert_receive",
    "owner": "supabase_realtime_admin",
    "command": "r",
    "permissive": true,
    "roles": [
      "anon",
      "authenticated"
    ],
    "definition": "CREATE POLICY \"ca_native_alert_receive\" ON \"realtime\".\"messages\" FOR SELECT TO \"anon\", \"authenticated\" USING (\"public\".\"fn_ca_native_alert_capability\"(\"realtime\".\"topic\"()));",
    "block": "-- Name: messages ca_native_alert_receive; Type: POLICY; Schema: realtime; Owner: supabase_realtime_admin\n--\n\nCREATE POLICY \"ca_native_alert_receive\" ON \"realtime\".\"messages\" FOR SELECT TO \"anon\", \"authenticated\" USING (\"public\".\"fn_ca_native_alert_capability\"(\"realtime\".\"topic\"()));\n\n\n--\n",
    "block_sha256": "4f9d40fc8c155888065680f99ad94fe10ab4e4582a31f14db2df67c45d77960a",
    "sources": [
      {
        "path": "supabase/migrations/20261027175950_native_alert_event_delivery.sql",
        "sha256": "462fe3433ede05af215c326d8c4772907f8b375ad04ab958b4cbee68f0948cc0",
        "statement_sha256": "603bdab021287d58cf92f875d0be81b8746e04e547d29a5066bba2626adedeff",
        "kind": "protected-policy-create"
      }
    ]
  },
  {
    "schema_name": "realtime",
    "relation_name": "messages",
    "policy_name": "club members receive roster wallet signals",
    "owner": "supabase_realtime_admin",
    "command": "r",
    "permissive": true,
    "roles": [
      "authenticated"
    ],
    "definition": "CREATE POLICY \"club members receive roster wallet signals\" ON \"realtime\".\"messages\" FOR SELECT TO \"authenticated\" USING (((\"extension\" = 'broadcast'::\"text\") AND (EXISTS ( SELECT 1\n   FROM ( SELECT\n                CASE\n                    WHEN (\"realtime\".\"topic\"() ~ '^club-roster-wallet:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::\"text\") THEN (\"split_part\"(\"realtime\".\"topic\"(), ':'::\"text\", 2))::\"uuid\"\n                    ELSE NULL::\"uuid\"\n                END AS \"club_id\") \"topic\"\n  WHERE ((\"topic\".\"club_id\" IS NOT NULL) AND (( SELECT \"auth\".\"uid\"() AS \"uid\") IS NOT NULL) AND ((EXISTS ( SELECT 1\n           FROM \"public\".\"club_members\" \"m\"\n          WHERE ((\"m\".\"club_id\" = \"topic\".\"club_id\") AND (\"m\".\"user_id\" = ( SELECT \"auth\".\"uid\"() AS \"uid\")) AND (COALESCE(\"m\".\"status\", 'approved'::\"text\") = ANY (ARRAY['active'::\"text\", 'approved'::\"text\"]))))) OR (EXISTS ( SELECT 1\n           FROM \"public\".\"profiles\" \"p\"\n          WHERE ((\"p\".\"id\" = ( SELECT \"auth\".\"uid\"() AS \"uid\")) AND \"p\".\"is_admin\"))) OR \"public\".\"fn_union_oversees_club\"(\"topic\".\"club_id\", ( SELECT \"auth\".\"uid\"() AS \"uid\"))))))));",
    "block": "-- Name: messages club members receive roster wallet signals; Type: POLICY; Schema: realtime; Owner: supabase_realtime_admin\n--\n\nCREATE POLICY \"club members receive roster wallet signals\" ON \"realtime\".\"messages\" FOR SELECT TO \"authenticated\" USING (((\"extension\" = 'broadcast'::\"text\") AND (EXISTS ( SELECT 1\n   FROM ( SELECT\n                CASE\n                    WHEN (\"realtime\".\"topic\"() ~ '^club-roster-wallet:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::\"text\") THEN (\"split_part\"(\"realtime\".\"topic\"(), ':'::\"text\", 2))::\"uuid\"\n                    ELSE NULL::\"uuid\"\n                END AS \"club_id\") \"topic\"\n  WHERE ((\"topic\".\"club_id\" IS NOT NULL) AND (( SELECT \"auth\".\"uid\"() AS \"uid\") IS NOT NULL) AND ((EXISTS ( SELECT 1\n           FROM \"public\".\"club_members\" \"m\"\n          WHERE ((\"m\".\"club_id\" = \"topic\".\"club_id\") AND (\"m\".\"user_id\" = ( SELECT \"auth\".\"uid\"() AS \"uid\")) AND (COALESCE(\"m\".\"status\", 'approved'::\"text\") = ANY (ARRAY['active'::\"text\", 'approved'::\"text\"]))))) OR (EXISTS ( SELECT 1\n           FROM \"public\".\"profiles\" \"p\"\n          WHERE ((\"p\".\"id\" = ( SELECT \"auth\".\"uid\"() AS \"uid\")) AND \"p\".\"is_admin\"))) OR \"public\".\"fn_union_oversees_club\"(\"topic\".\"club_id\", ( SELECT \"auth\".\"uid\"() AS \"uid\"))))))));\n\n\n--\n",
    "block_sha256": "2a37dc8f2fc0b08a90d611a0d55ba2077aed850eda40678a409a49b0b5783453",
    "sources": [
      {
        "path": "supabase/migrations/20261010215645_agent_wallet_changes_emit_private_roster_signals.sql",
        "sha256": "ce4294a07086306fc1ca6e501a0c9e470d2d2cfc8ad57226fbc0cf6c9f659552",
        "statement_sha256": "aa983a6dc24cebd9324cde55bb6495d93fe8e63a1975ac92f360352839831e37",
        "kind": "protected-policy-create"
      }
    ]
  },
  {
    "schema_name": "realtime",
    "relation_name": "messages",
    "policy_name": "players receive their own account change signal",
    "owner": "supabase_realtime_admin",
    "command": "r",
    "permissive": true,
    "roles": [
      "authenticated"
    ],
    "definition": "CREATE POLICY \"players receive their own account change signal\" ON \"realtime\".\"messages\" FOR SELECT TO \"authenticated\" USING (((\"extension\" = 'broadcast'::\"text\") AND (( SELECT \"realtime\".\"topic\"() AS \"topic\") = ('profile-account:'::\"text\" || (( SELECT \"auth\".\"uid\"() AS \"uid\"))::\"text\"))));",
    "block": "-- Name: messages players receive their own account change signal; Type: POLICY; Schema: realtime; Owner: supabase_realtime_admin\n--\n\nCREATE POLICY \"players receive their own account change signal\" ON \"realtime\".\"messages\" FOR SELECT TO \"authenticated\" USING (((\"extension\" = 'broadcast'::\"text\") AND (( SELECT \"realtime\".\"topic\"() AS \"topic\") = ('profile-account:'::\"text\" || (( SELECT \"auth\".\"uid\"() AS \"uid\"))::\"text\"))));\n\n\n--\n",
    "block_sha256": "9a86f1f974cbd32994c76316865e5c89b601e902815beb040c46fc34d2207816",
    "sources": [
      {
        "path": "supabase/migrations/20260927001026_own_account_changes_send_bounded_private_signals.sql",
        "sha256": "4db16ed07853d99e37280c1505a44822c7b4aa7035c671da2727d391231662ff",
        "statement_sha256": "eea028dc870b37db044d0c5fb97e398b785040ad05d67af05b63832f440e8531",
        "kind": "protected-policy-create"
      }
    ]
  },
  {
    "schema_name": "realtime",
    "relation_name": "messages",
    "policy_name": "players receive their own appearance signal",
    "owner": "supabase_realtime_admin",
    "command": "r",
    "permissive": true,
    "roles": [
      "authenticated"
    ],
    "definition": "CREATE POLICY \"players receive their own appearance signal\" ON \"realtime\".\"messages\" FOR SELECT TO \"authenticated\" USING (((\"extension\" = 'broadcast'::\"text\") AND (( SELECT \"realtime\".\"topic\"() AS \"topic\") = ('profile-appearance:'::\"text\" || (( SELECT \"auth\".\"uid\"() AS \"uid\"))::\"text\"))));",
    "block": "-- Name: messages players receive their own appearance signal; Type: POLICY; Schema: realtime; Owner: supabase_realtime_admin\n--\n\nCREATE POLICY \"players receive their own appearance signal\" ON \"realtime\".\"messages\" FOR SELECT TO \"authenticated\" USING (((\"extension\" = 'broadcast'::\"text\") AND (( SELECT \"realtime\".\"topic\"() AS \"topic\") = ('profile-appearance:'::\"text\" || (( SELECT \"auth\".\"uid\"() AS \"uid\"))::\"text\"))));\n\n\n--\n",
    "block_sha256": "7e0aa80acaa3f3835fd459da504498ef5388218820b0f9ccb40597347827dc89",
    "sources": [
      {
        "path": "supabase/migrations/20260926150415_profile_appearance_changes_have_a_private_bounded_signal.sql",
        "sha256": "c84997599df87e366c24027cb38809e5f481484f769193d32083f99e0b15b911",
        "statement_sha256": "7b76944874d1b596ffe33d52e8adf68d69ba522215db5ebefb80523fc08fabf9",
        "kind": "protected-policy-create"
      }
    ]
  },
  {
    "schema_name": "realtime",
    "relation_name": "messages",
    "policy_name": "readable tables receive appearance signals",
    "owner": "supabase_realtime_admin",
    "command": "r",
    "permissive": true,
    "roles": [
      "authenticated"
    ],
    "definition": "CREATE POLICY \"readable tables receive appearance signals\" ON \"realtime\".\"messages\" FOR SELECT TO \"authenticated\" USING (((\"extension\" = 'broadcast'::\"text\") AND (EXISTS ( SELECT 1\n   FROM \"public\".\"tables\" \"t\"\n  WHERE (\"t\".\"id\" = ( SELECT\n                CASE\n                    WHEN (\"realtime\".\"topic\"() ~ '^table-appearance:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::\"text\") THEN (\"split_part\"(\"realtime\".\"topic\"(), ':'::\"text\", 2))::\"uuid\"\n                    ELSE NULL::\"uuid\"\n                END AS \"case\"))))));",
    "block": "-- Name: messages readable tables receive appearance signals; Type: POLICY; Schema: realtime; Owner: supabase_realtime_admin\n--\n\nCREATE POLICY \"readable tables receive appearance signals\" ON \"realtime\".\"messages\" FOR SELECT TO \"authenticated\" USING (((\"extension\" = 'broadcast'::\"text\") AND (EXISTS ( SELECT 1\n   FROM \"public\".\"tables\" \"t\"\n  WHERE (\"t\".\"id\" = ( SELECT\n                CASE\n                    WHEN (\"realtime\".\"topic\"() ~ '^table-appearance:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::\"text\") THEN (\"split_part\"(\"realtime\".\"topic\"(), ':'::\"text\", 2))::\"uuid\"\n                    ELSE NULL::\"uuid\"\n                END AS \"case\"))))));\n\n\n--\n",
    "block_sha256": "45098a31fad407444ba94c5882461d6f675bd9d1e15a478f99d03c3939c695cc",
    "sources": [
      {
        "path": "supabase/migrations/20260926150415_profile_appearance_changes_have_a_private_bounded_signal.sql",
        "sha256": "c84997599df87e366c24027cb38809e5f481484f769193d32083f99e0b15b911",
        "statement_sha256": "283846cef6f74ecfe80169d9afcdd3bb607de5687e7ecf9250b70873c9542e24",
        "kind": "protected-policy-create"
      }
    ]
  },
  {
    "schema_name": "realtime",
    "relation_name": "messages",
    "policy_name": "users receive own daily mission completion broadcasts",
    "owner": "supabase_realtime_admin",
    "command": "r",
    "permissive": true,
    "roles": [
      "authenticated"
    ],
    "definition": "CREATE POLICY \"users receive own daily mission completion broadcasts\" ON \"realtime\".\"messages\" FOR SELECT TO \"authenticated\" USING (((\"extension\" = 'broadcast'::\"text\") AND (( SELECT \"realtime\".\"topic\"() AS \"topic\") = ('daily-mission-completion:'::\"text\" || (( SELECT \"auth\".\"uid\"() AS \"uid\"))::\"text\"))));",
    "block": "-- Name: messages users receive own daily mission completion broadcasts; Type: POLICY; Schema: realtime; Owner: supabase_realtime_admin\n--\n\nCREATE POLICY \"users receive own daily mission completion broadcasts\" ON \"realtime\".\"messages\" FOR SELECT TO \"authenticated\" USING (((\"extension\" = 'broadcast'::\"text\") AND (( SELECT \"realtime\".\"topic\"() AS \"topic\") = ('daily-mission-completion:'::\"text\" || (( SELECT \"auth\".\"uid\"() AS \"uid\"))::\"text\"))));\n\n\n--\n",
    "block_sha256": "0af394c30a6b17c4a2c8850fc02c09a534a96f99d5c96ac2cf55e667c616c435",
    "sources": [
      {
        "path": "supabase/migrations/20260906093500_daily_mission_certification_repairs.sql",
        "sha256": "d2ad6212ca394a0b5f7686bfe69b98fa0e9f9f62c617fef377c5d3e6b3cece24",
        "statement_sha256": "9d09e5327c632fdf08f074c93f9ced0e4d2442601ef62cb5f10113241d2e7fdd",
        "kind": "protected-policy-create"
      }
    ]
  },
  {
    "schema_name": "realtime",
    "relation_name": "messages",
    "policy_name": "users receive own daily mission revision broadcasts",
    "owner": "supabase_realtime_admin",
    "command": "r",
    "permissive": true,
    "roles": [
      "authenticated"
    ],
    "definition": "CREATE POLICY \"users receive own daily mission revision broadcasts\" ON \"realtime\".\"messages\" FOR SELECT TO \"authenticated\" USING (((\"extension\" = 'broadcast'::\"text\") AND (( SELECT \"realtime\".\"topic\"() AS \"topic\") = ('daily-mission-revision:'::\"text\" || (( SELECT \"auth\".\"uid\"() AS \"uid\"))::\"text\"))));",
    "block": "-- Name: messages users receive own daily mission revision broadcasts; Type: POLICY; Schema: realtime; Owner: supabase_realtime_admin\n--\n\nCREATE POLICY \"users receive own daily mission revision broadcasts\" ON \"realtime\".\"messages\" FOR SELECT TO \"authenticated\" USING (((\"extension\" = 'broadcast'::\"text\") AND (( SELECT \"realtime\".\"topic\"() AS \"topic\") = ('daily-mission-revision:'::\"text\" || (( SELECT \"auth\".\"uid\"() AS \"uid\"))::\"text\"))));\n\n\n--\n",
    "block_sha256": "ec11b60daf405025eab81cf4da5e554b87db230a0c6d7a0eda4636be06e813da",
    "sources": [
      {
        "path": "supabase/migrations/20260902060000_daily_mission_private_broadcast.sql",
        "sha256": "20bae6cc59f506815952c1ba4ef04e3638578e3cb54944ea7c1555827b5529b3",
        "statement_sha256": "2119fe70432605a1e31f2d3e3e768c800406b3239cb704b6becbb7c53b592bb0",
        "kind": "protected-policy-create"
      }
    ]
  }
];
export const APPLICATION_POLICY_WITNESSES = Object.freeze(witnesses.map(item => Object.freeze({
  ...item, roles: Object.freeze(item.roles), sources: Object.freeze(item.sources.map(Object.freeze)),
})));

export function applicationPolicyWitness(item) {
  if (item.type !== 'POLICY' || item.schema !== 'realtime') return null;
  const witness = APPLICATION_POLICY_WITNESSES.find(expected =>
    item.name === expected.relation_name + ' ' + expected.policy_name);
  if (!witness || item.owner !== witness.owner || item.text !== witness.block ||
      item.key !== JSON.stringify(['POLICY', witness.schema_name, witness.relation_name + ' ' + witness.policy_name]) ||
      createHash('sha256').update(item.text).digest('hex') !== witness.block_sha256)
    throw new Error('SCHEMA_APPLICATION_POLICY_REFUSED');
  return {key:item.key,block_sha256:witness.block_sha256,schema:witness.schema_name,
    relation:witness.relation_name,policy:witness.policy_name,command:witness.command,
    permissive:witness.permissive,roles:[...witness.roles],sources:witness.sources.map(source=>({...source}))};
}
