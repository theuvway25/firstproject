-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  status USER-DEFINED NOT NULL DEFAULT 'ACTIVE'::user_status,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  deleted_at timestamp with time zone,
  role character varying NOT NULL DEFAULT 'USER'::character varying CHECK (role::text = ANY (ARRAY['USER'::character varying, 'QC'::character varying, 'ADMIN'::character varying]::text[])),
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.coa_modules (
  module_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  module_name text NOT NULL UNIQUE,
  is_core boolean NOT NULL DEFAULT false,
  category USER-DEFINED NOT NULL DEFAULT 'INDIVIDUAL'::module_category,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT coa_modules_pkey PRIMARY KEY (module_id)
);
CREATE TABLE public.user_modules (
  user_id uuid NOT NULL,
  module_id bigint NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_modules_pkey PRIMARY KEY (user_id, module_id),
  CONSTRAINT user_modules_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT user_modules_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.coa_modules(module_id)
);
CREATE TABLE public.coa_templates (
  template_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  module_id bigint NOT NULL,
  account_name text NOT NULL,
  account_type USER-DEFINED NOT NULL,
  balance_nature USER-DEFINED NOT NULL,
  is_system_generated boolean NOT NULL DEFAULT true,
  parent_template_id bigint,
  created_at timestamp with time zone DEFAULT now(),
  include_in_llm boolean DEFAULT true,
  CONSTRAINT coa_templates_pkey PRIMARY KEY (template_id),
  CONSTRAINT coa_templates_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.coa_modules(module_id),
  CONSTRAINT coa_templates_parent_template_id_fkey FOREIGN KEY (parent_template_id) REFERENCES public.coa_templates(template_id)
);
CREATE TABLE public.accounts (
  account_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid NOT NULL,
  account_name text NOT NULL,
  account_type USER-DEFINED NOT NULL,
  balance_nature USER-DEFINED NOT NULL,
  is_system_generated boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  parent_account_id bigint,
  template_id bigint,
  created_at timestamp with time zone DEFAULT now(),
  include_in_llm boolean DEFAULT true,
  external_id character varying,
  source text DEFAULT 'manual'::text,
  CONSTRAINT accounts_pkey PRIMARY KEY (account_id),
  CONSTRAINT accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT accounts_parent_account_id_fkey FOREIGN KEY (parent_account_id) REFERENCES public.accounts(account_id),
  CONSTRAINT accounts_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.coa_templates(template_id)
);
CREATE TABLE public.account_identifiers (
  identifier_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  account_id bigint NOT NULL,
  user_id uuid NOT NULL,
  institution_name text,
  account_number_masked text,
  account_number_last4 character varying,
  ifsc_code character varying,
  card_network text,
  card_last4 character varying,
  wallet_id text,
  is_primary boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT account_identifiers_pkey PRIMARY KEY (identifier_id),
  CONSTRAINT account_identifiers_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(account_id),
  CONSTRAINT account_identifiers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.documents (
  document_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid NOT NULL,
  file_name text NOT NULL,
  status USER-DEFINED NOT NULL DEFAULT 'UPLOADED'::doc_status,
  created_at timestamp with time zone DEFAULT now(),
  statement_id bigint,
  file_path character varying,
  is_password_protected boolean DEFAULT false,
  transaction_parsed_type character varying,
  parser_version character varying,
  is_active boolean DEFAULT true,
  account_id bigint,
  account_match_confidence numeric,
  processing_started_at timestamp with time zone,
  processing_completed_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now(),
  grouping_status text DEFAULT 'pending'::text,
  pipeline_started_at timestamp with time zone,
  pipeline_error text,
  CONSTRAINT documents_pkey PRIMARY KEY (document_id),
  CONSTRAINT documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT documents_statement_id_fkey FOREIGN KEY (statement_id) REFERENCES public.statement_categories(statement_id)
);
CREATE TABLE public.ai_transactions_staging (
  staging_transaction_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  document_id bigint NOT NULL,
  user_id uuid NOT NULL,
  transaction_json jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  parser_type character varying,
  overall_confidence numeric,
  CONSTRAINT ai_transactions_staging_pkey PRIMARY KEY (staging_transaction_id),
  CONSTRAINT ai_transactions_staging_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(document_id),
  CONSTRAINT ai_transactions_staging_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.uncategorized_transactions (
  uncategorized_transaction_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid NOT NULL,
  account_id bigint,
  document_id bigint,
  staging_transaction_id bigint,
  txn_date date NOT NULL,
  debit numeric,
  credit numeric,
  balance numeric,
  details text,
  created_at timestamp with time zone DEFAULT now(),
  status text NOT NULL DEFAULT 'PENDING'::text CHECK (status = ANY (ARRAY['PENDING'::text, 'CATEGORISED'::text])),
  group_id uuid,
  pre_pipeline_strategy text,
  grouping_status text DEFAULT 'pending'::text,
  vector_cache_ref bigint,
  embedding USER-DEFINED,
  clean_merchant_name text,
  CONSTRAINT uncategorized_transactions_pkey PRIMARY KEY (uncategorized_transaction_id),
  CONSTRAINT uncategorized_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT uncategorized_transactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(account_id),
  CONSTRAINT uncategorized_transactions_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(document_id),
  CONSTRAINT uncategorized_transactions_staging_transaction_id_fkey FOREIGN KEY (staging_transaction_id) REFERENCES public.ai_transactions_staging(staging_transaction_id),
  CONSTRAINT fk_vector_cache_ref FOREIGN KEY (vector_cache_ref) REFERENCES public.personal_vector_cache(cache_id)
);
CREATE TABLE public.transactions (
  transaction_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid NOT NULL,
  base_account_id bigint NOT NULL,
  offset_account_id bigint,
  document_id bigint,
  transaction_date date NOT NULL,
  details text,
  clean_merchant_name text,
  amount numeric NOT NULL,
  transaction_type USER-DEFINED NOT NULL,
  categorised_by USER-DEFINED NOT NULL,
  confidence_score numeric NOT NULL,
  vector_distance numeric,
  posting_status USER-DEFINED DEFAULT 'DRAFT'::posting_status,
  attention_level USER-DEFINED NOT NULL DEFAULT 'LOW'::attention_level,
  review_status USER-DEFINED NOT NULL DEFAULT 'PENDING'::review_status,
  uncategorized_transaction_id bigint,
  created_at timestamp with time zone DEFAULT now(),
  is_contra boolean NOT NULL DEFAULT false,
  extracted_id text,
  is_uncategorised boolean NOT NULL DEFAULT false,
  merchant_id text,
  user_note text,
  external_id character varying,
  source text DEFAULT 'manual'::text,
  CONSTRAINT transactions_pkey PRIMARY KEY (transaction_id),
  CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT transactions_base_account_id_fkey FOREIGN KEY (base_account_id) REFERENCES public.accounts(account_id),
  CONSTRAINT transactions_offset_account_id_fkey FOREIGN KEY (offset_account_id) REFERENCES public.accounts(account_id),
  CONSTRAINT transactions_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(document_id),
  CONSTRAINT transactions_uncategorized_transaction_id_fkey FOREIGN KEY (uncategorized_transaction_id) REFERENCES public.uncategorized_transactions(uncategorized_transaction_id)
);
CREATE TABLE public.routing_rules (
  rule_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  rule_name text NOT NULL,
  match_type USER-DEFINED NOT NULL DEFAULT 'REGEX'::match_type,
  pattern text NOT NULL,
  strategy_type USER-DEFINED NOT NULL,
  target_template_id bigint,
  hit_count integer DEFAULT 0,
  priority integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT routing_rules_pkey PRIMARY KEY (rule_id),
  CONSTRAINT routing_rules_target_template_id_fkey FOREIGN KEY (target_template_id) REFERENCES public.coa_templates(template_id)
);
CREATE TABLE public.global_vector_cache (
  cache_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  clean_name text NOT NULL UNIQUE,
  target_template_id bigint,
  embedding USER-DEFINED NOT NULL,
  approval_count integer DEFAULT 1,
  is_verified boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  is_semantic_anchor boolean DEFAULT false,
  CONSTRAINT global_vector_cache_pkey PRIMARY KEY (cache_id),
  CONSTRAINT global_vector_cache_target_template_id_fkey FOREIGN KEY (target_template_id) REFERENCES public.coa_templates(template_id)
);
CREATE TABLE public.personal_exact_cache (
  user_id uuid NOT NULL,
  raw_vpa text NOT NULL,
  account_id bigint NOT NULL,
  hit_count integer DEFAULT 1,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT personal_exact_cache_pkey PRIMARY KEY (user_id, raw_vpa),
  CONSTRAINT personal_exact_cache_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT personal_exact_cache_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(account_id)
);
CREATE TABLE public.personal_vector_cache (
  cache_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid NOT NULL,
  clean_name text NOT NULL,
  account_id bigint,
  embedding USER-DEFINED NOT NULL,
  hit_count integer DEFAULT 1,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  status text DEFAULT 'confirmed'::text,
  CONSTRAINT personal_vector_cache_pkey PRIMARY KEY (cache_id),
  CONSTRAINT personal_vector_cache_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT personal_vector_cache_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(account_id)
);
CREATE TABLE public.journal_entries (
  journal_entry_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  transaction_id bigint NOT NULL,
  account_id bigint NOT NULL,
  debit_amount numeric NOT NULL DEFAULT 0.00,
  credit_amount numeric NOT NULL DEFAULT 0.00,
  entry_date date NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  user_id uuid NOT NULL,
  external_id text,
  CONSTRAINT journal_entries_pkey PRIMARY KEY (journal_entry_id),
  CONSTRAINT journal_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT journal_entries_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(transaction_id),
  CONSTRAINT journal_entries_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(account_id)
);
CREATE TABLE public.user_sessions (
  session_id bigint NOT NULL DEFAULT nextval('user_sessions_session_id_seq'::regclass),
  user_id uuid NOT NULL,
  token character varying NOT NULL UNIQUE,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_sessions_pkey PRIMARY KEY (session_id),
  CONSTRAINT user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.statement_categories (
  statement_id bigint NOT NULL DEFAULT nextval('statement_categories_statement_id_seq'::regclass),
  statement_type character varying NOT NULL,
  format_name character varying NOT NULL,
  institution_name character varying NOT NULL,
  ifsc_code character varying,
  statement_identifier jsonb NOT NULL,
  extraction_logic text NOT NULL,
  match_threshold numeric DEFAULT 65.00,
  logic_version integer DEFAULT 1,
  status character varying DEFAULT 'UNDER_REVIEW'::character varying,
  success_rate numeric,
  last_verified_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  sender_email_patterns ARRAY,
  CONSTRAINT statement_categories_pkey PRIMARY KEY (statement_id)
);
CREATE TABLE public.document_password (
  document_id bigint NOT NULL,
  encrypted_password character varying NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT document_password_pkey PRIMARY KEY (document_id),
  CONSTRAINT document_password_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(document_id)
);
CREATE TABLE public.document_upload_audit (
  audit_id bigint NOT NULL DEFAULT nextval('document_upload_audit_audit_id_seq'::regclass),
  document_id bigint NOT NULL,
  status text NOT NULL,
  error_message character varying,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT document_upload_audit_pkey PRIMARY KEY (audit_id),
  CONSTRAINT document_upload_audit_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(document_id)
);
CREATE TABLE public.document_text_extractions (
  text_extraction_id bigint NOT NULL DEFAULT nextval('document_text_extractions_text_extraction_id_seq'::regclass),
  document_id bigint NOT NULL,
  extraction_method character varying DEFAULT 'PDF_TEXT'::character varying,
  extracted_text text NOT NULL,
  extraction_status character varying DEFAULT 'SUCCESS'::character varying,
  error_message character varying,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT document_text_extractions_pkey PRIMARY KEY (text_extraction_id),
  CONSTRAINT document_text_extractions_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(document_id)
);
CREATE TABLE public.document_account_match_log (
  match_id bigint NOT NULL DEFAULT nextval('document_account_match_log_match_id_seq'::regclass),
  document_id bigint NOT NULL,
  user_id uuid NOT NULL,
  detected_institution character varying,
  detected_account_last4 character varying,
  matched_account_id bigint,
  confidence_score numeric,
  match_status character varying,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT document_account_match_log_pkey PRIMARY KEY (match_id),
  CONSTRAINT document_account_match_log_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(document_id),
  CONSTRAINT document_account_match_log_matched_account_id_fkey FOREIGN KEY (matched_account_id) REFERENCES public.accounts(account_id),
  CONSTRAINT document_account_match_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.ai_chat_sessions (
  session_id bigint NOT NULL DEFAULT nextval('ai_chat_sessions_session_id_seq'::regclass),
  user_id uuid NOT NULL,
  started_at timestamp with time zone DEFAULT now(),
  CONSTRAINT ai_chat_sessions_pkey PRIMARY KEY (session_id),
  CONSTRAINT ai_chat_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.ai_chat_messages (
  message_id bigint NOT NULL DEFAULT nextval('ai_chat_messages_message_id_seq'::regclass),
  session_id bigint NOT NULL,
  sender character varying NOT NULL,
  message_text text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT ai_chat_messages_pkey PRIMARY KEY (message_id),
  CONSTRAINT ai_chat_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.ai_chat_sessions(session_id)
);
CREATE TABLE public.ai_monthly_summaries (
  summary_id bigint NOT NULL DEFAULT nextval('ai_monthly_summaries_summary_id_seq'::regclass),
  user_id uuid NOT NULL,
  summary_month character NOT NULL,
  summary_text text NOT NULL,
  generated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT ai_monthly_summaries_pkey PRIMARY KEY (summary_id),
  CONSTRAINT ai_monthly_summaries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.random_qc_results (
  qc_id bigint NOT NULL DEFAULT nextval('random_qc_results_qc_id_seq'::regclass),
  document_id bigint NOT NULL,
  statement_id bigint NOT NULL,
  file_name character varying,
  institution_name character varying,
  code_txn_count integer DEFAULT 0,
  llm_txn_count integer DEFAULT 0,
  matched_count integer DEFAULT 0,
  unmatched_code_count integer DEFAULT 0,
  unmatched_llm_count integer DEFAULT 0,
  accuracy numeric DEFAULT 0.00,
  reconciliation_json jsonb,
  code_txn_json jsonb,
  llm_txn_json jsonb,
  qc_status character varying DEFAULT 'PENDING'::character varying,
  reviewer_notes text,
  issue_type character varying,
  assigned_to character varying,
  created_at timestamp with time zone DEFAULT now(),
  reviewed_at timestamp with time zone,
  CONSTRAINT random_qc_results_pkey PRIMARY KEY (qc_id),
  CONSTRAINT random_qc_results_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(document_id),
  CONSTRAINT random_qc_results_statement_id_fkey FOREIGN KEY (statement_id) REFERENCES public.statement_categories(statement_id)
);
CREATE TABLE public.user_id_mapping (
  mysql_user_id bigint NOT NULL,
  supabase_user_id uuid NOT NULL UNIQUE,
  email character varying,
  mapped_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_id_mapping_pkey PRIMARY KEY (mysql_user_id),
  CONSTRAINT user_id_mapping_supabase_user_id_fkey FOREIGN KEY (supabase_user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.transaction_overrides (
  override_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  staging_transaction_id bigint NOT NULL,
  field_name character varying NOT NULL,
  ai_value text,
  user_value text,
  overridden_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT transaction_overrides_pkey PRIMARY KEY (override_id),
  CONSTRAINT transaction_overrides_staging_transaction_id_fkey FOREIGN KEY (staging_transaction_id) REFERENCES public.ai_transactions_staging(staging_transaction_id)
);
CREATE TABLE public.global_keyword_rules (
  keyword_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  keyword text NOT NULL,
  target_template_id bigint NOT NULL,
  match_type text DEFAULT 'CONTAINS'::text CHECK (match_type = ANY (ARRAY['EXACT'::text, 'CONTAINS'::text])),
  priority integer DEFAULT 0,
  hit_count integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT global_keyword_rules_pkey PRIMARY KEY (keyword_id),
  CONSTRAINT fk_template FOREIGN KEY (target_template_id) REFERENCES public.coa_templates(template_id)
);
CREATE TABLE public.user_bank_passwords (
  password_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid NOT NULL,
  institution_name text NOT NULL,
  encrypted_password text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_bank_passwords_pkey PRIMARY KEY (password_id),
  CONSTRAINT user_bank_passwords_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.user_email_configs (
  config_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid NOT NULL,
  email text,
  provider text DEFAULT 'GMAIL'::text,
  refresh_token text NOT NULL,
  is_sync_enabled boolean DEFAULT true,
  sync_mode text DEFAULT 'AUTO'::text,
  last_sync_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_email_configs_pkey PRIMARY KEY (config_id),
  CONSTRAINT user_email_configs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.llm_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  uncategorized_transaction_id bigint,
  user_id uuid NOT NULL,
  document_id integer NOT NULL,
  status text DEFAULT 'pending'::text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT llm_queue_pkey PRIMARY KEY (id),
  CONSTRAINT llm_queue_uncategorized_transaction_id_fkey FOREIGN KEY (uncategorized_transaction_id) REFERENCES public.uncategorized_transactions(uncategorized_transaction_id)
);
CREATE TABLE public.zoho_integrations (
  integration_id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  zoho_organization_id text NOT NULL,
  zoho_organization_name text,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_expires_at timestamp with time zone NOT NULL,
  api_domain text NOT NULL DEFAULT 'https://www.zohoapis.com'::text,
  migration_completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  zoho_user_email text,
  token_domain text,
  CONSTRAINT zoho_integrations_pkey PRIMARY KEY (integration_id),
  CONSTRAINT zoho_integrations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.zoho_imports (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid NOT NULL,
  zoho_org_id text NOT NULL,
  zoho_raw_type text NOT NULL,
  zoho_id text NOT NULL,
  raw_payload jsonb NOT NULL,
  processed boolean NOT NULL DEFAULT false,
  processed_at timestamp with time zone,
  processing_error text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT zoho_imports_pkey PRIMARY KEY (id),
  CONSTRAINT zoho_imports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);