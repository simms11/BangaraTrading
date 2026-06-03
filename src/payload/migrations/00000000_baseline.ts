import { sql, type MigrateUpArgs, type MigrateDownArgs } from '@payloadcms/db-postgres'

/**
 * Baseline schema migration (Phase 5.20).
 *
 * Creates every base table, enum, sequence, index and foreign key the
 * application relies on. Prior to this the migrations registry only
 * contained ALTER/index migrations (5.11/5.16/5.18) that assumed the
 * base tables already existed — true in dev/staging because schema-push
 * builds them, but FALSE on a clean production database where
 * PAYLOAD_DISABLE_SCHEMA_PUSH=true forces migrations-only mode. The first
 * ALTER then failed with "relation orders does not exist" and aborted the
 * deploy. This baseline closes that gap; it must run FIRST.
 *
 * The DDL is a captured snapshot of the schema-push output (pg_dump of a
 * freshly-pushed database), with the runner-managed payload_migrations
 * table excluded. It is guarded by a single existence check: if
 * public.orders already exists (an established database that was
 * schema-pushed before this baseline was introduced), the whole migration
 * no-ops — so it is safe on both a brand-new and a pre-existing database.
 */
export const name = '00000000_baseline'

const BASELINE_SQL = `CREATE TYPE public.enum_audit_log_actor_role AS ENUM (
    'admin',
    'vendor',
    'customer',
    'system'
);

CREATE TYPE public.enum_audit_log_kind AS ENUM (
    'order.created',
    'order.status_changed',
    'refund.created',
    'refund.completed',
    'vendor.approved',
    'vendor.status_changed',
    'product.price_changed',
    'product.status_changed',
    'inventory.revert_failed',
    'user.role_changed',
    'user.sessions_revoked',
    'payout.status_changed',
    'user.deleted'
);

CREATE TYPE public.enum_orders_currency AS ENUM (
    'NAD',
    'ZAR',
    'USD',
    'GBP',
    'EUR'
);

CREATE TYPE public.enum_orders_payment_processor AS ENUM (
    'stripe',
    'flutterwave',
    'manual'
);

CREATE TYPE public.enum_orders_status AS ENUM (
    'pending_payment',
    'paid',
    'processing',
    'shipped',
    'delivered',
    'cancelled',
    'refunded',
    'disputed'
);

CREATE TYPE public.enum_pages_status AS ENUM (
    'draft',
    'published'
);

CREATE TYPE public.enum_payload_jobs_log_state AS ENUM (
    'failed',
    'succeeded'
);

CREATE TYPE public.enum_payload_jobs_log_task_slug AS ENUM (
    'inline',
    'expireQuotes',
    'cleanGuestCarts',
    'pruneProcessedEvents',
    'pruneAuditLog',
    'sweepAbandonedOrders',
    'retryFailedEmail'
);

CREATE TYPE public.enum_payload_jobs_task_slug AS ENUM (
    'inline',
    'expireQuotes',
    'cleanGuestCarts',
    'pruneProcessedEvents',
    'pruneAuditLog',
    'sweepAbandonedOrders',
    'retryFailedEmail'
);

CREATE TYPE public.enum_payouts_currency AS ENUM (
    'NAD',
    'ZAR',
    'USD',
    'GBP',
    'EUR'
);

CREATE TYPE public.enum_payouts_status AS ENUM (
    'pending',
    'processing',
    'paid',
    'cancelled'
);

CREATE TYPE public.enum_processed_events_processor AS ENUM (
    'stripe',
    'flutterwave'
);

CREATE TYPE public.enum_products_currency AS ENUM (
    'NAD',
    'ZAR',
    'USD',
    'GBP',
    'EUR'
);

CREATE TYPE public.enum_products_fulfillment_mode AS ENUM (
    'retail',
    'quote',
    'hybrid'
);

CREATE TYPE public.enum_products_status AS ENUM (
    'draft',
    'pending',
    'published',
    'archived'
);

CREATE TYPE public.enum_quotes_currency AS ENUM (
    'NAD',
    'ZAR',
    'USD',
    'GBP',
    'EUR'
);

CREATE TYPE public.enum_quotes_status AS ENUM (
    'submitted',
    'reviewing',
    'quoted',
    'accepted',
    'declined',
    'converted',
    'expired'
);

CREATE TYPE public.enum_refunds_currency AS ENUM (
    'NAD',
    'ZAR',
    'USD',
    'GBP',
    'EUR'
);

CREATE TYPE public.enum_refunds_processor AS ENUM (
    'stripe',
    'flutterwave',
    'manual'
);

CREATE TYPE public.enum_refunds_reason AS ENUM (
    'requested_by_customer',
    'quality',
    'out_of_stock',
    'lost_in_transit',
    'fraud',
    'other'
);

CREATE TYPE public.enum_refunds_status AS ENUM (
    'pending',
    'processing',
    'completed',
    'failed',
    'cancelled'
);

CREATE TYPE public.enum_users_role AS ENUM (
    'admin',
    'vendor',
    'customer'
);

CREATE TYPE public.enum_vendors_payout_method AS ENUM (
    'bank',
    'stripe_connect',
    'flutterwave_sub'
);

CREATE TYPE public.enum_vendors_status AS ENUM (
    'pending',
    'active',
    'paused',
    'banned'
);

CREATE TABLE public.audit_log (
    id integer NOT NULL,
    kind public.enum_audit_log_kind NOT NULL,
    subject_type character varying NOT NULL,
    subject_id character varying NOT NULL,
    actor_id character varying,
    actor_email character varying,
    actor_role public.enum_audit_log_actor_role,
    diff jsonb,
    notes character varying,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;

CREATE TABLE public.categories (
    id integer NOT NULL,
    name character varying NOT NULL,
    slug character varying NOT NULL,
    description character varying,
    parent_id integer,
    image_id integer,
    "order" numeric DEFAULT 0,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.categories_id_seq OWNED BY public.categories.id;

CREATE TABLE public.media (
    id integer NOT NULL,
    alt character varying NOT NULL,
    caption character varying,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    url character varying,
    thumbnail_u_r_l character varying,
    filename character varying,
    mime_type character varying,
    filesize numeric,
    width numeric,
    height numeric,
    focal_x numeric,
    focal_y numeric,
    sizes_thumbnail_url character varying,
    sizes_thumbnail_width numeric,
    sizes_thumbnail_height numeric,
    sizes_thumbnail_mime_type character varying,
    sizes_thumbnail_filesize numeric,
    sizes_thumbnail_filename character varying,
    sizes_card_url character varying,
    sizes_card_width numeric,
    sizes_card_height numeric,
    sizes_card_mime_type character varying,
    sizes_card_filesize numeric,
    sizes_card_filename character varying,
    sizes_feature_url character varying,
    sizes_feature_width numeric,
    sizes_feature_height numeric,
    sizes_feature_mime_type character varying,
    sizes_feature_filesize numeric,
    sizes_feature_filename character varying,
    sizes_og_url character varying,
    sizes_og_width numeric,
    sizes_og_height numeric,
    sizes_og_mime_type character varying,
    sizes_og_filesize numeric,
    sizes_og_filename character varying
);

CREATE SEQUENCE public.media_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.media_id_seq OWNED BY public.media.id;

CREATE TABLE public.orders (
    id integer NOT NULL,
    order_number character varying NOT NULL,
    confirmation_token character varying NOT NULL,
    status public.enum_orders_status DEFAULT 'pending_payment'::public.enum_orders_status NOT NULL,
    customer_id integer,
    guest_email character varying,
    inventory_decremented boolean DEFAULT false,
    subtotal_minor numeric NOT NULL,
    shipping_minor numeric DEFAULT 0,
    tax_minor numeric DEFAULT 0,
    discount_minor numeric DEFAULT 0,
    total_minor numeric NOT NULL,
    currency public.enum_orders_currency NOT NULL,
    payment_processor public.enum_orders_payment_processor,
    payment_processor_ref character varying,
    payment_processor_intent_ref character varying,
    payment_paid_at timestamp(3) with time zone,
    shipping_address_name character varying,
    shipping_address_line1 character varying,
    shipping_address_line2 character varying,
    shipping_address_city character varying,
    shipping_address_region character varying,
    shipping_address_postal_code character varying,
    shipping_address_country character varying,
    shipping_address_phone character varying,
    billing_address_name character varying,
    billing_address_line1 character varying,
    billing_address_line2 character varying,
    billing_address_city character varying,
    billing_address_region character varying,
    billing_address_postal_code character varying,
    billing_address_country character varying,
    fulfillment_carrier character varying,
    fulfillment_tracking_number character varying,
    fulfillment_shipped_at timestamp(3) with time zone,
    fulfillment_delivered_at timestamp(3) with time zone,
    notes character varying,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.orders_id_seq OWNED BY public.orders.id;

CREATE TABLE public.orders_line_items (
    _order integer NOT NULL,
    _parent_id integer NOT NULL,
    id character varying NOT NULL,
    product_id integer NOT NULL,
    vendor_id integer NOT NULL,
    title_snapshot character varying NOT NULL,
    sku_snapshot character varying,
    quantity numeric NOT NULL,
    unit_price_minor numeric NOT NULL,
    line_total_minor numeric NOT NULL
);

CREATE TABLE public.pages (
    id integer NOT NULL,
    title character varying NOT NULL,
    slug character varying NOT NULL,
    status public.enum_pages_status DEFAULT 'draft'::public.enum_pages_status,
    content jsonb,
    seo_title character varying,
    seo_description character varying,
    seo_image_id integer,
    meta_title character varying,
    meta_description character varying,
    meta_image_id integer,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.pages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.pages_id_seq OWNED BY public.pages.id;

CREATE TABLE public.payload_jobs (
    id integer NOT NULL,
    input jsonb,
    completed_at timestamp(3) with time zone,
    total_tried numeric DEFAULT 0,
    has_error boolean DEFAULT false,
    error jsonb,
    task_slug public.enum_payload_jobs_task_slug,
    queue character varying DEFAULT 'default'::character varying,
    wait_until timestamp(3) with time zone,
    processing boolean DEFAULT false,
    meta jsonb,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.payload_jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.payload_jobs_id_seq OWNED BY public.payload_jobs.id;

CREATE TABLE public.payload_jobs_log (
    _order integer NOT NULL,
    _parent_id integer NOT NULL,
    id character varying NOT NULL,
    executed_at timestamp(3) with time zone NOT NULL,
    completed_at timestamp(3) with time zone NOT NULL,
    task_slug public.enum_payload_jobs_log_task_slug NOT NULL,
    task_i_d character varying NOT NULL,
    input jsonb,
    output jsonb,
    state public.enum_payload_jobs_log_state NOT NULL,
    error jsonb
);

CREATE TABLE public.payload_jobs_stats (
    id integer NOT NULL,
    stats jsonb,
    updated_at timestamp(3) with time zone,
    created_at timestamp(3) with time zone
);

CREATE SEQUENCE public.payload_jobs_stats_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.payload_jobs_stats_id_seq OWNED BY public.payload_jobs_stats.id;

CREATE TABLE public.payload_kv (
    id integer NOT NULL,
    key character varying NOT NULL,
    data jsonb NOT NULL
);

CREATE SEQUENCE public.payload_kv_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.payload_kv_id_seq OWNED BY public.payload_kv.id;

CREATE TABLE public.payload_locked_documents (
    id integer NOT NULL,
    global_slug character varying,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.payload_locked_documents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.payload_locked_documents_id_seq OWNED BY public.payload_locked_documents.id;

CREATE TABLE public.payload_locked_documents_rels (
    id integer NOT NULL,
    "order" integer,
    parent_id integer NOT NULL,
    path character varying NOT NULL,
    users_id integer,
    vendors_id integer,
    categories_id integer,
    products_id integer,
    orders_id integer,
    quotes_id integer,
    pages_id integer,
    media_id integer,
    payouts_id integer,
    refunds_id integer,
    processed_events_id integer,
    audit_log_id integer
);

CREATE SEQUENCE public.payload_locked_documents_rels_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.payload_locked_documents_rels_id_seq OWNED BY public.payload_locked_documents_rels.id;

CREATE TABLE public.payload_preferences (
    id integer NOT NULL,
    key character varying,
    value jsonb,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.payload_preferences_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.payload_preferences_id_seq OWNED BY public.payload_preferences.id;

CREATE TABLE public.payload_preferences_rels (
    id integer NOT NULL,
    "order" integer,
    parent_id integer NOT NULL,
    path character varying NOT NULL,
    users_id integer
);

CREATE SEQUENCE public.payload_preferences_rels_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.payload_preferences_rels_id_seq OWNED BY public.payload_preferences_rels.id;

CREATE TABLE public.payouts (
    id integer NOT NULL,
    reference character varying NOT NULL,
    vendor_id integer NOT NULL,
    status public.enum_payouts_status DEFAULT 'pending'::public.enum_payouts_status NOT NULL,
    period_start timestamp(3) with time zone NOT NULL,
    period_end timestamp(3) with time zone NOT NULL,
    total_gross_minor numeric DEFAULT 0 NOT NULL,
    total_commission_minor numeric DEFAULT 0 NOT NULL,
    total_payout_minor numeric DEFAULT 0 NOT NULL,
    currency public.enum_payouts_currency DEFAULT 'NAD'::public.enum_payouts_currency NOT NULL,
    paid_at timestamp(3) with time zone,
    notes character varying,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.payouts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.payouts_id_seq OWNED BY public.payouts.id;

CREATE TABLE public.payouts_lines (
    _order integer NOT NULL,
    _parent_id integer NOT NULL,
    id character varying NOT NULL,
    order_ref_id integer NOT NULL,
    order_number_snapshot character varying NOT NULL,
    paid_at timestamp(3) with time zone,
    gross_minor numeric NOT NULL,
    commission_minor numeric NOT NULL,
    payout_minor numeric NOT NULL
);

CREATE TABLE public.processed_events (
    id integer NOT NULL,
    key character varying NOT NULL,
    processor public.enum_processed_events_processor NOT NULL,
    kind character varying,
    order_id character varying,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.processed_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.processed_events_id_seq OWNED BY public.processed_events.id;

CREATE TABLE public.products (
    id integer NOT NULL,
    title character varying NOT NULL,
    slug character varying NOT NULL,
    vendor_id integer NOT NULL,
    status public.enum_products_status DEFAULT 'draft'::public.enum_products_status NOT NULL,
    fulfillment_mode public.enum_products_fulfillment_mode DEFAULT 'retail'::public.enum_products_fulfillment_mode NOT NULL,
    short_description character varying,
    description jsonb,
    price_minor numeric NOT NULL,
    compare_at_minor numeric,
    currency public.enum_products_currency DEFAULT 'NAD'::public.enum_products_currency NOT NULL,
    sku character varying,
    inventory_track_quantity boolean DEFAULT true,
    inventory_quantity numeric DEFAULT 0,
    inventory_allow_backorder boolean DEFAULT false,
    inventory_low_stock_threshold numeric DEFAULT 5,
    shipping_weight_grams numeric,
    shipping_length_cm numeric,
    shipping_width_cm numeric,
    shipping_height_cm numeric,
    shipping_requires_shipping boolean DEFAULT true,
    seo_title character varying,
    seo_description character varying,
    seo_image_id integer,
    meta_title character varying,
    meta_description character varying,
    meta_image_id integer,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.products_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.products_id_seq OWNED BY public.products.id;

CREATE TABLE public.products_images (
    _order integer NOT NULL,
    _parent_id integer NOT NULL,
    id character varying NOT NULL,
    image_id integer NOT NULL,
    alt character varying NOT NULL
);

CREATE TABLE public.products_rels (
    id integer NOT NULL,
    "order" integer,
    parent_id integer NOT NULL,
    path character varying NOT NULL,
    categories_id integer
);

CREATE SEQUENCE public.products_rels_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.products_rels_id_seq OWNED BY public.products_rels.id;

CREATE TABLE public.products_tags (
    _order integer NOT NULL,
    _parent_id integer NOT NULL,
    id character varying NOT NULL,
    value character varying NOT NULL
);

CREATE TABLE public.quotes (
    id integer NOT NULL,
    quote_number character varying NOT NULL,
    confirmation_token character varying NOT NULL,
    status public.enum_quotes_status DEFAULT 'submitted'::public.enum_quotes_status NOT NULL,
    customer_id integer,
    customer_name character varying NOT NULL,
    customer_email character varying NOT NULL,
    customer_phone character varying,
    company_name character varying,
    destination_country character varying,
    total_estimate_minor numeric,
    currency public.enum_quotes_currency DEFAULT 'NAD'::public.enum_quotes_currency,
    message character varying,
    response_message character varying,
    response_responded_by_id integer,
    response_responded_at timestamp(3) with time zone,
    response_valid_until timestamp(3) with time zone,
    converted_order_id integer,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.quotes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.quotes_id_seq OWNED BY public.quotes.id;

CREATE TABLE public.quotes_items (
    _order integer NOT NULL,
    _parent_id integer NOT NULL,
    id character varying NOT NULL,
    product_id integer NOT NULL,
    vendor_id integer NOT NULL,
    title_snapshot character varying NOT NULL,
    quantity numeric NOT NULL,
    notes character varying,
    unit_price_quote_minor numeric
);

CREATE TABLE public.refunds (
    id integer NOT NULL,
    reference character varying NOT NULL,
    order_id integer NOT NULL,
    status public.enum_refunds_status DEFAULT 'pending'::public.enum_refunds_status NOT NULL,
    amount_minor numeric NOT NULL,
    currency public.enum_refunds_currency DEFAULT 'NAD'::public.enum_refunds_currency NOT NULL,
    reason public.enum_refunds_reason DEFAULT 'requested_by_customer'::public.enum_refunds_reason NOT NULL,
    description character varying,
    processor public.enum_refunds_processor,
    processor_ref character varying,
    customer_id integer,
    vendor_ref_id integer,
    refunded_at timestamp(3) with time zone,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.refunds_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.refunds_id_seq OWNED BY public.refunds.id;

CREATE TABLE public.site_settings (
    id integer NOT NULL,
    hero_eyebrow character varying DEFAULT 'Marketplace for African & Caribbean sole traders'::character varying,
    hero_headline_leading character varying DEFAULT 'Real provenance.'::character varying,
    hero_headline_trailing character varying DEFAULT 'Premium taste.'::character varying,
    hero_subhead character varying DEFAULT 'Patented Ayisha''s Herbal and Kiyaya''s sauces, pure Namibian honey, and curated Pan-African and Caribbean imports — sold directly by the makers, shipped across Africa and the diaspora.'::character varying,
    announcement_enabled boolean DEFAULT false,
    announcement_text character varying,
    announcement_link_label character varying,
    announcement_link_href character varying,
    updated_at timestamp(3) with time zone,
    created_at timestamp(3) with time zone
);

CREATE SEQUENCE public.site_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.site_settings_id_seq OWNED BY public.site_settings.id;

CREATE TABLE public.site_settings_rels (
    id integer NOT NULL,
    "order" integer,
    parent_id integer NOT NULL,
    path character varying NOT NULL,
    products_id integer
);

CREATE SEQUENCE public.site_settings_rels_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.site_settings_rels_id_seq OWNED BY public.site_settings_rels.id;

CREATE TABLE public.users (
    id integer NOT NULL,
    name character varying NOT NULL,
    role public.enum_users_role DEFAULT 'customer'::public.enum_users_role NOT NULL,
    vendor_id integer,
    phone character varying,
    marketing_opt_in boolean DEFAULT false,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    email character varying NOT NULL,
    reset_password_token character varying,
    reset_password_expiration timestamp(3) with time zone,
    salt character varying,
    hash character varying,
    login_attempts numeric DEFAULT 0,
    lock_until timestamp(3) with time zone
);

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;

CREATE TABLE public.users_sessions (
    _order integer NOT NULL,
    _parent_id integer NOT NULL,
    id character varying NOT NULL,
    created_at timestamp(3) with time zone,
    expires_at timestamp(3) with time zone NOT NULL
);

CREATE TABLE public.vendors (
    id integer NOT NULL,
    name character varying NOT NULL,
    slug character varying NOT NULL,
    status public.enum_vendors_status DEFAULT 'pending'::public.enum_vendors_status NOT NULL,
    tagline character varying,
    bio character varying,
    logo_id integer,
    country character varying DEFAULT 'NA'::character varying,
    city character varying,
    commission_rate numeric DEFAULT 10,
    payout_method public.enum_vendors_payout_method,
    payout_bank_name character varying,
    payout_account_holder character varying,
    payout_account_number character varying,
    payout_swift_bic character varying,
    payout_stripe_connect_account_id character varying,
    payout_flutterwave_sub_account_id character varying,
    meta_title character varying,
    meta_description character varying,
    meta_image_id integer,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.vendors_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.vendors_id_seq OWNED BY public.vendors.id;

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);

ALTER TABLE ONLY public.categories ALTER COLUMN id SET DEFAULT nextval('public.categories_id_seq'::regclass);

ALTER TABLE ONLY public.media ALTER COLUMN id SET DEFAULT nextval('public.media_id_seq'::regclass);

ALTER TABLE ONLY public.orders ALTER COLUMN id SET DEFAULT nextval('public.orders_id_seq'::regclass);

ALTER TABLE ONLY public.pages ALTER COLUMN id SET DEFAULT nextval('public.pages_id_seq'::regclass);

ALTER TABLE ONLY public.payload_jobs ALTER COLUMN id SET DEFAULT nextval('public.payload_jobs_id_seq'::regclass);

ALTER TABLE ONLY public.payload_jobs_stats ALTER COLUMN id SET DEFAULT nextval('public.payload_jobs_stats_id_seq'::regclass);

ALTER TABLE ONLY public.payload_kv ALTER COLUMN id SET DEFAULT nextval('public.payload_kv_id_seq'::regclass);

ALTER TABLE ONLY public.payload_locked_documents ALTER COLUMN id SET DEFAULT nextval('public.payload_locked_documents_id_seq'::regclass);

ALTER TABLE ONLY public.payload_locked_documents_rels ALTER COLUMN id SET DEFAULT nextval('public.payload_locked_documents_rels_id_seq'::regclass);

ALTER TABLE ONLY public.payload_preferences ALTER COLUMN id SET DEFAULT nextval('public.payload_preferences_id_seq'::regclass);

ALTER TABLE ONLY public.payload_preferences_rels ALTER COLUMN id SET DEFAULT nextval('public.payload_preferences_rels_id_seq'::regclass);

ALTER TABLE ONLY public.payouts ALTER COLUMN id SET DEFAULT nextval('public.payouts_id_seq'::regclass);

ALTER TABLE ONLY public.processed_events ALTER COLUMN id SET DEFAULT nextval('public.processed_events_id_seq'::regclass);

ALTER TABLE ONLY public.products ALTER COLUMN id SET DEFAULT nextval('public.products_id_seq'::regclass);

ALTER TABLE ONLY public.products_rels ALTER COLUMN id SET DEFAULT nextval('public.products_rels_id_seq'::regclass);

ALTER TABLE ONLY public.quotes ALTER COLUMN id SET DEFAULT nextval('public.quotes_id_seq'::regclass);

ALTER TABLE ONLY public.refunds ALTER COLUMN id SET DEFAULT nextval('public.refunds_id_seq'::regclass);

ALTER TABLE ONLY public.site_settings ALTER COLUMN id SET DEFAULT nextval('public.site_settings_id_seq'::regclass);

ALTER TABLE ONLY public.site_settings_rels ALTER COLUMN id SET DEFAULT nextval('public.site_settings_rels_id_seq'::regclass);

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);

ALTER TABLE ONLY public.vendors ALTER COLUMN id SET DEFAULT nextval('public.vendors_id_seq'::regclass);

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.orders_line_items
    ADD CONSTRAINT orders_line_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.payload_jobs_log
    ADD CONSTRAINT payload_jobs_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.payload_jobs
    ADD CONSTRAINT payload_jobs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.payload_jobs_stats
    ADD CONSTRAINT payload_jobs_stats_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.payload_kv
    ADD CONSTRAINT payload_kv_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.payload_locked_documents
    ADD CONSTRAINT payload_locked_documents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.payload_preferences
    ADD CONSTRAINT payload_preferences_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.payload_preferences_rels
    ADD CONSTRAINT payload_preferences_rels_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.payouts_lines
    ADD CONSTRAINT payouts_lines_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.processed_events
    ADD CONSTRAINT processed_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.products_images
    ADD CONSTRAINT products_images_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.products_rels
    ADD CONSTRAINT products_rels_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.products_tags
    ADD CONSTRAINT products_tags_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.quotes_items
    ADD CONSTRAINT quotes_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.site_settings
    ADD CONSTRAINT site_settings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.site_settings_rels
    ADD CONSTRAINT site_settings_rels_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users_sessions
    ADD CONSTRAINT users_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_pkey PRIMARY KEY (id);

CREATE INDEX audit_log_created_at_idx ON public.audit_log USING btree (created_at);

CREATE INDEX audit_log_kind_idx ON public.audit_log USING btree (kind);

CREATE INDEX audit_log_subject_id_idx ON public.audit_log USING btree (subject_id);

CREATE INDEX audit_log_updated_at_idx ON public.audit_log USING btree (updated_at);

CREATE INDEX categories_created_at_idx ON public.categories USING btree (created_at);

CREATE INDEX categories_image_idx ON public.categories USING btree (image_id);

CREATE INDEX categories_parent_idx ON public.categories USING btree (parent_id);

CREATE UNIQUE INDEX categories_slug_idx ON public.categories USING btree (slug);

CREATE INDEX categories_updated_at_idx ON public.categories USING btree (updated_at);

CREATE INDEX media_created_at_idx ON public.media USING btree (created_at);

CREATE UNIQUE INDEX media_filename_idx ON public.media USING btree (filename);

CREATE INDEX media_sizes_card_sizes_card_filename_idx ON public.media USING btree (sizes_card_filename);

CREATE INDEX media_sizes_feature_sizes_feature_filename_idx ON public.media USING btree (sizes_feature_filename);

CREATE INDEX media_sizes_og_sizes_og_filename_idx ON public.media USING btree (sizes_og_filename);

CREATE INDEX media_sizes_thumbnail_sizes_thumbnail_filename_idx ON public.media USING btree (sizes_thumbnail_filename);

CREATE INDEX media_updated_at_idx ON public.media USING btree (updated_at);

CREATE INDEX orders_created_at_idx ON public.orders USING btree (created_at);

CREATE INDEX orders_customer_idx ON public.orders USING btree (customer_id);

CREATE INDEX orders_line_items_order_idx ON public.orders_line_items USING btree (_order);

CREATE INDEX orders_line_items_parent_id_idx ON public.orders_line_items USING btree (_parent_id);

CREATE INDEX orders_line_items_product_idx ON public.orders_line_items USING btree (product_id);

CREATE INDEX orders_line_items_vendor_idx ON public.orders_line_items USING btree (vendor_id);

CREATE UNIQUE INDEX orders_order_number_idx ON public.orders USING btree (order_number);

CREATE INDEX orders_payment_payment_processor_intent_ref_idx ON public.orders USING btree (payment_processor_intent_ref);

CREATE INDEX orders_updated_at_idx ON public.orders USING btree (updated_at);

CREATE INDEX pages_created_at_idx ON public.pages USING btree (created_at);

CREATE INDEX pages_meta_meta_image_idx ON public.pages USING btree (meta_image_id);

CREATE INDEX pages_seo_seo_image_idx ON public.pages USING btree (seo_image_id);

CREATE UNIQUE INDEX pages_slug_idx ON public.pages USING btree (slug);

CREATE INDEX pages_updated_at_idx ON public.pages USING btree (updated_at);

CREATE INDEX payload_jobs_completed_at_idx ON public.payload_jobs USING btree (completed_at);

CREATE INDEX payload_jobs_created_at_idx ON public.payload_jobs USING btree (created_at);

CREATE INDEX payload_jobs_has_error_idx ON public.payload_jobs USING btree (has_error);

CREATE INDEX payload_jobs_log_order_idx ON public.payload_jobs_log USING btree (_order);

CREATE INDEX payload_jobs_log_parent_id_idx ON public.payload_jobs_log USING btree (_parent_id);

CREATE INDEX payload_jobs_processing_idx ON public.payload_jobs USING btree (processing);

CREATE INDEX payload_jobs_queue_idx ON public.payload_jobs USING btree (queue);

CREATE INDEX payload_jobs_task_slug_idx ON public.payload_jobs USING btree (task_slug);

CREATE INDEX payload_jobs_total_tried_idx ON public.payload_jobs USING btree (total_tried);

CREATE INDEX payload_jobs_updated_at_idx ON public.payload_jobs USING btree (updated_at);

CREATE INDEX payload_jobs_wait_until_idx ON public.payload_jobs USING btree (wait_until);

CREATE UNIQUE INDEX payload_kv_key_idx ON public.payload_kv USING btree (key);

CREATE INDEX payload_locked_documents_created_at_idx ON public.payload_locked_documents USING btree (created_at);

CREATE INDEX payload_locked_documents_global_slug_idx ON public.payload_locked_documents USING btree (global_slug);

CREATE INDEX payload_locked_documents_rels_audit_log_id_idx ON public.payload_locked_documents_rels USING btree (audit_log_id);

CREATE INDEX payload_locked_documents_rels_categories_id_idx ON public.payload_locked_documents_rels USING btree (categories_id);

CREATE INDEX payload_locked_documents_rels_media_id_idx ON public.payload_locked_documents_rels USING btree (media_id);

CREATE INDEX payload_locked_documents_rels_order_idx ON public.payload_locked_documents_rels USING btree ("order");

CREATE INDEX payload_locked_documents_rels_orders_id_idx ON public.payload_locked_documents_rels USING btree (orders_id);

CREATE INDEX payload_locked_documents_rels_pages_id_idx ON public.payload_locked_documents_rels USING btree (pages_id);

CREATE INDEX payload_locked_documents_rels_parent_idx ON public.payload_locked_documents_rels USING btree (parent_id);

CREATE INDEX payload_locked_documents_rels_path_idx ON public.payload_locked_documents_rels USING btree (path);

CREATE INDEX payload_locked_documents_rels_payouts_id_idx ON public.payload_locked_documents_rels USING btree (payouts_id);

CREATE INDEX payload_locked_documents_rels_processed_events_id_idx ON public.payload_locked_documents_rels USING btree (processed_events_id);

CREATE INDEX payload_locked_documents_rels_products_id_idx ON public.payload_locked_documents_rels USING btree (products_id);

CREATE INDEX payload_locked_documents_rels_quotes_id_idx ON public.payload_locked_documents_rels USING btree (quotes_id);

CREATE INDEX payload_locked_documents_rels_refunds_id_idx ON public.payload_locked_documents_rels USING btree (refunds_id);

CREATE INDEX payload_locked_documents_rels_users_id_idx ON public.payload_locked_documents_rels USING btree (users_id);

CREATE INDEX payload_locked_documents_rels_vendors_id_idx ON public.payload_locked_documents_rels USING btree (vendors_id);

CREATE INDEX payload_locked_documents_updated_at_idx ON public.payload_locked_documents USING btree (updated_at);

CREATE INDEX payload_preferences_created_at_idx ON public.payload_preferences USING btree (created_at);

CREATE INDEX payload_preferences_key_idx ON public.payload_preferences USING btree (key);

CREATE INDEX payload_preferences_rels_order_idx ON public.payload_preferences_rels USING btree ("order");

CREATE INDEX payload_preferences_rels_parent_idx ON public.payload_preferences_rels USING btree (parent_id);

CREATE INDEX payload_preferences_rels_path_idx ON public.payload_preferences_rels USING btree (path);

CREATE INDEX payload_preferences_rels_users_id_idx ON public.payload_preferences_rels USING btree (users_id);

CREATE INDEX payload_preferences_updated_at_idx ON public.payload_preferences USING btree (updated_at);

CREATE INDEX payouts_created_at_idx ON public.payouts USING btree (created_at);

CREATE INDEX payouts_lines_order_idx ON public.payouts_lines USING btree (_order);

CREATE INDEX payouts_lines_order_ref_idx ON public.payouts_lines USING btree (order_ref_id);

CREATE INDEX payouts_lines_parent_id_idx ON public.payouts_lines USING btree (_parent_id);

CREATE UNIQUE INDEX payouts_reference_idx ON public.payouts USING btree (reference);

CREATE INDEX payouts_updated_at_idx ON public.payouts USING btree (updated_at);

CREATE INDEX payouts_vendor_idx ON public.payouts USING btree (vendor_id);

CREATE INDEX processed_events_created_at_idx ON public.processed_events USING btree (created_at);

CREATE UNIQUE INDEX processed_events_key_idx ON public.processed_events USING btree (key);

CREATE INDEX processed_events_updated_at_idx ON public.processed_events USING btree (updated_at);

CREATE INDEX products_created_at_idx ON public.products USING btree (created_at);

CREATE INDEX products_images_image_idx ON public.products_images USING btree (image_id);

CREATE INDEX products_images_order_idx ON public.products_images USING btree (_order);

CREATE INDEX products_images_parent_id_idx ON public.products_images USING btree (_parent_id);

CREATE INDEX products_meta_meta_image_idx ON public.products USING btree (meta_image_id);

CREATE INDEX products_rels_categories_id_idx ON public.products_rels USING btree (categories_id);

CREATE INDEX products_rels_order_idx ON public.products_rels USING btree ("order");

CREATE INDEX products_rels_parent_idx ON public.products_rels USING btree (parent_id);

CREATE INDEX products_rels_path_idx ON public.products_rels USING btree (path);

CREATE INDEX products_seo_seo_image_idx ON public.products USING btree (seo_image_id);

CREATE UNIQUE INDEX products_sku_idx ON public.products USING btree (sku);

CREATE UNIQUE INDEX products_slug_idx ON public.products USING btree (slug);

CREATE INDEX products_tags_order_idx ON public.products_tags USING btree (_order);

CREATE INDEX products_tags_parent_id_idx ON public.products_tags USING btree (_parent_id);

CREATE INDEX products_updated_at_idx ON public.products USING btree (updated_at);

CREATE INDEX products_vendor_idx ON public.products USING btree (vendor_id);

CREATE INDEX quotes_converted_order_idx ON public.quotes USING btree (converted_order_id);

CREATE INDEX quotes_created_at_idx ON public.quotes USING btree (created_at);

CREATE INDEX quotes_customer_idx ON public.quotes USING btree (customer_id);

CREATE INDEX quotes_items_order_idx ON public.quotes_items USING btree (_order);

CREATE INDEX quotes_items_parent_id_idx ON public.quotes_items USING btree (_parent_id);

CREATE INDEX quotes_items_product_idx ON public.quotes_items USING btree (product_id);

CREATE INDEX quotes_items_vendor_idx ON public.quotes_items USING btree (vendor_id);

CREATE UNIQUE INDEX quotes_quote_number_idx ON public.quotes USING btree (quote_number);

CREATE INDEX quotes_response_response_responded_by_idx ON public.quotes USING btree (response_responded_by_id);

CREATE INDEX quotes_updated_at_idx ON public.quotes USING btree (updated_at);

CREATE INDEX refunds_created_at_idx ON public.refunds USING btree (created_at);

CREATE INDEX refunds_customer_idx ON public.refunds USING btree (customer_id);

CREATE INDEX refunds_order_idx ON public.refunds USING btree (order_id);

CREATE UNIQUE INDEX refunds_reference_idx ON public.refunds USING btree (reference);

CREATE INDEX refunds_updated_at_idx ON public.refunds USING btree (updated_at);

CREATE INDEX refunds_vendor_ref_idx ON public.refunds USING btree (vendor_ref_id);

CREATE INDEX site_settings_rels_order_idx ON public.site_settings_rels USING btree ("order");

CREATE INDEX site_settings_rels_parent_idx ON public.site_settings_rels USING btree (parent_id);

CREATE INDEX site_settings_rels_path_idx ON public.site_settings_rels USING btree (path);

CREATE INDEX site_settings_rels_products_id_idx ON public.site_settings_rels USING btree (products_id);

CREATE INDEX users_created_at_idx ON public.users USING btree (created_at);

CREATE UNIQUE INDEX users_email_idx ON public.users USING btree (email);

CREATE INDEX users_sessions_order_idx ON public.users_sessions USING btree (_order);

CREATE INDEX users_sessions_parent_id_idx ON public.users_sessions USING btree (_parent_id);

CREATE INDEX users_updated_at_idx ON public.users USING btree (updated_at);

CREATE INDEX users_vendor_idx ON public.users USING btree (vendor_id);

CREATE INDEX vendors_created_at_idx ON public.vendors USING btree (created_at);

CREATE INDEX vendors_logo_idx ON public.vendors USING btree (logo_id);

CREATE INDEX vendors_meta_meta_image_idx ON public.vendors USING btree (meta_image_id);

CREATE UNIQUE INDEX vendors_slug_idx ON public.vendors USING btree (slug);

CREATE INDEX vendors_updated_at_idx ON public.vendors USING btree (updated_at);

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_image_id_media_id_fk FOREIGN KEY (image_id) REFERENCES public.media(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_parent_id_categories_id_fk FOREIGN KEY (parent_id) REFERENCES public.categories(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_customer_id_users_id_fk FOREIGN KEY (customer_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.orders_line_items
    ADD CONSTRAINT orders_line_items_parent_id_fk FOREIGN KEY (_parent_id) REFERENCES public.orders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.orders_line_items
    ADD CONSTRAINT orders_line_items_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.orders_line_items
    ADD CONSTRAINT orders_line_items_vendor_id_vendors_id_fk FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_meta_image_id_media_id_fk FOREIGN KEY (meta_image_id) REFERENCES public.media(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_seo_image_id_media_id_fk FOREIGN KEY (seo_image_id) REFERENCES public.media(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.payload_jobs_log
    ADD CONSTRAINT payload_jobs_log_parent_id_fk FOREIGN KEY (_parent_id) REFERENCES public.payload_jobs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_audit_log_fk FOREIGN KEY (audit_log_id) REFERENCES public.audit_log(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_categories_fk FOREIGN KEY (categories_id) REFERENCES public.categories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_media_fk FOREIGN KEY (media_id) REFERENCES public.media(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_orders_fk FOREIGN KEY (orders_id) REFERENCES public.orders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_pages_fk FOREIGN KEY (pages_id) REFERENCES public.pages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_parent_fk FOREIGN KEY (parent_id) REFERENCES public.payload_locked_documents(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_payouts_fk FOREIGN KEY (payouts_id) REFERENCES public.payouts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_processed_events_fk FOREIGN KEY (processed_events_id) REFERENCES public.processed_events(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_products_fk FOREIGN KEY (products_id) REFERENCES public.products(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_quotes_fk FOREIGN KEY (quotes_id) REFERENCES public.quotes(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_refunds_fk FOREIGN KEY (refunds_id) REFERENCES public.refunds(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_users_fk FOREIGN KEY (users_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_vendors_fk FOREIGN KEY (vendors_id) REFERENCES public.vendors(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payload_preferences_rels
    ADD CONSTRAINT payload_preferences_rels_parent_fk FOREIGN KEY (parent_id) REFERENCES public.payload_preferences(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payload_preferences_rels
    ADD CONSTRAINT payload_preferences_rels_users_fk FOREIGN KEY (users_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payouts_lines
    ADD CONSTRAINT payouts_lines_order_ref_id_orders_id_fk FOREIGN KEY (order_ref_id) REFERENCES public.orders(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.payouts_lines
    ADD CONSTRAINT payouts_lines_parent_id_fk FOREIGN KEY (_parent_id) REFERENCES public.payouts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_vendor_id_vendors_id_fk FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.products_images
    ADD CONSTRAINT products_images_image_id_media_id_fk FOREIGN KEY (image_id) REFERENCES public.media(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.products_images
    ADD CONSTRAINT products_images_parent_id_fk FOREIGN KEY (_parent_id) REFERENCES public.products(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_meta_image_id_media_id_fk FOREIGN KEY (meta_image_id) REFERENCES public.media(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.products_rels
    ADD CONSTRAINT products_rels_categories_fk FOREIGN KEY (categories_id) REFERENCES public.categories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.products_rels
    ADD CONSTRAINT products_rels_parent_fk FOREIGN KEY (parent_id) REFERENCES public.products(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_seo_image_id_media_id_fk FOREIGN KEY (seo_image_id) REFERENCES public.media(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.products_tags
    ADD CONSTRAINT products_tags_parent_id_fk FOREIGN KEY (_parent_id) REFERENCES public.products(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_vendor_id_vendors_id_fk FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_converted_order_id_orders_id_fk FOREIGN KEY (converted_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_customer_id_users_id_fk FOREIGN KEY (customer_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.quotes_items
    ADD CONSTRAINT quotes_items_parent_id_fk FOREIGN KEY (_parent_id) REFERENCES public.quotes(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.quotes_items
    ADD CONSTRAINT quotes_items_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.quotes_items
    ADD CONSTRAINT quotes_items_vendor_id_vendors_id_fk FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_response_responded_by_id_users_id_fk FOREIGN KEY (response_responded_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_customer_id_users_id_fk FOREIGN KEY (customer_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_order_id_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_vendor_ref_id_vendors_id_fk FOREIGN KEY (vendor_ref_id) REFERENCES public.vendors(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.site_settings_rels
    ADD CONSTRAINT site_settings_rels_parent_fk FOREIGN KEY (parent_id) REFERENCES public.site_settings(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_settings_rels
    ADD CONSTRAINT site_settings_rels_products_fk FOREIGN KEY (products_id) REFERENCES public.products(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users_sessions
    ADD CONSTRAINT users_sessions_parent_id_fk FOREIGN KEY (_parent_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_vendor_id_vendors_id_fk FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_logo_id_media_id_fk FOREIGN KEY (logo_id) REFERENCES public.media(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_meta_image_id_media_id_fk FOREIGN KEY (meta_image_id) REFERENCES public.media(id) ON DELETE SET NULL;`

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // Skip on an already-provisioned database (idempotent for existing prod
  // that predates this baseline). to_regclass returns NULL when absent.
  const existing = await db.execute(sql`SELECT to_regclass('public.orders') AS rel`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rel = (existing as any)?.rows?.[0]?.rel
  if (rel) return
  await db.execute(sql.raw(BASELINE_SQL))
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Teardown drops every object this baseline created. Destructive — only
  // runs on an explicit migrate:down to the very first migration.
  const statements: string[] = [
      'DROP TABLE IF EXISTS public.audit_log CASCADE',
      'DROP TABLE IF EXISTS public.categories CASCADE',
      'DROP TABLE IF EXISTS public.media CASCADE',
      'DROP TABLE IF EXISTS public.orders CASCADE',
      'DROP TABLE IF EXISTS public.orders_line_items CASCADE',
      'DROP TABLE IF EXISTS public.pages CASCADE',
      'DROP TABLE IF EXISTS public.payload_jobs CASCADE',
      'DROP TABLE IF EXISTS public.payload_jobs_log CASCADE',
      'DROP TABLE IF EXISTS public.payload_jobs_stats CASCADE',
      'DROP TABLE IF EXISTS public.payload_kv CASCADE',
      'DROP TABLE IF EXISTS public.payload_locked_documents CASCADE',
      'DROP TABLE IF EXISTS public.payload_locked_documents_rels CASCADE',
      'DROP TABLE IF EXISTS public.payload_preferences CASCADE',
      'DROP TABLE IF EXISTS public.payload_preferences_rels CASCADE',
      'DROP TABLE IF EXISTS public.payouts CASCADE',
      'DROP TABLE IF EXISTS public.payouts_lines CASCADE',
      'DROP TABLE IF EXISTS public.processed_events CASCADE',
      'DROP TABLE IF EXISTS public.products CASCADE',
      'DROP TABLE IF EXISTS public.products_images CASCADE',
      'DROP TABLE IF EXISTS public.products_rels CASCADE',
      'DROP TABLE IF EXISTS public.products_tags CASCADE',
      'DROP TABLE IF EXISTS public.quotes CASCADE',
      'DROP TABLE IF EXISTS public.quotes_items CASCADE',
      'DROP TABLE IF EXISTS public.refunds CASCADE',
      'DROP TABLE IF EXISTS public.site_settings CASCADE',
      'DROP TABLE IF EXISTS public.site_settings_rels CASCADE',
      'DROP TABLE IF EXISTS public.users CASCADE',
      'DROP TABLE IF EXISTS public.users_sessions CASCADE',
      'DROP TABLE IF EXISTS public.vendors CASCADE',
      'DROP TYPE IF EXISTS public.enum_audit_log_actor_role CASCADE',
      'DROP TYPE IF EXISTS public.enum_audit_log_kind CASCADE',
      'DROP TYPE IF EXISTS public.enum_orders_currency CASCADE',
      'DROP TYPE IF EXISTS public.enum_orders_payment_processor CASCADE',
      'DROP TYPE IF EXISTS public.enum_orders_status CASCADE',
      'DROP TYPE IF EXISTS public.enum_pages_status CASCADE',
      'DROP TYPE IF EXISTS public.enum_payload_jobs_log_state CASCADE',
      'DROP TYPE IF EXISTS public.enum_payload_jobs_log_task_slug CASCADE',
      'DROP TYPE IF EXISTS public.enum_payload_jobs_task_slug CASCADE',
      'DROP TYPE IF EXISTS public.enum_payouts_currency CASCADE',
      'DROP TYPE IF EXISTS public.enum_payouts_status CASCADE',
      'DROP TYPE IF EXISTS public.enum_processed_events_processor CASCADE',
      'DROP TYPE IF EXISTS public.enum_products_currency CASCADE',
      'DROP TYPE IF EXISTS public.enum_products_fulfillment_mode CASCADE',
      'DROP TYPE IF EXISTS public.enum_products_status CASCADE',
      'DROP TYPE IF EXISTS public.enum_quotes_currency CASCADE',
      'DROP TYPE IF EXISTS public.enum_quotes_status CASCADE',
      'DROP TYPE IF EXISTS public.enum_refunds_currency CASCADE',
      'DROP TYPE IF EXISTS public.enum_refunds_processor CASCADE',
      'DROP TYPE IF EXISTS public.enum_refunds_reason CASCADE',
      'DROP TYPE IF EXISTS public.enum_refunds_status CASCADE',
      'DROP TYPE IF EXISTS public.enum_users_role CASCADE',
      'DROP TYPE IF EXISTS public.enum_vendors_payout_method CASCADE',
      'DROP TYPE IF EXISTS public.enum_vendors_status CASCADE',
  ]
  for (const s of statements) {
    await db.execute(sql.raw(s))
  }
}
