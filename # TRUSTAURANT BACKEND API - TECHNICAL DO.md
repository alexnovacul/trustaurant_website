# TRUSTAURANT BACKEND API - TECHNICAL DOCUMENTATION
**Internal Use Only - Code-Derived Technical Reference**

**Document Version:** 1.0  
**Generated From:** Production Laravel Backend Codebase  
**Date:** 2024

---

## DISCLAIMER

This document is derived exclusively from static code analysis of the Laravel backend codebase. All information presented is based on code structure, validation rules, middleware configurations, and route definitions found in the source code. 

**CRITICAL NOTES:**
- No secrets, environment values, tokens, or real user data are included
- Undocumented behavior should be treated as unsupported
- Any API behavior not explicitly defined in code is marked as "NOT DEFINED IN CODE"
- Assumptions beyond direct code evidence are explicitly marked
- This document is for internal backend team use only

---

## 1. SYSTEM OVERVIEW

### What the Backend Does
The Trustaurant backend is a Laravel-based food ordering and restaurant management platform that provides:
- Customer mobile app API for restaurant discovery, ordering, and wallet management
- Restaurant app API for order management, menu management, and business operations
- Guest/public APIs for unauthenticated browsing
- Tally integration APIs for accounting/financial data export
- Admin panel (web-based, not documented in this API reference)

### Major Modules and Responsibilities

**1. Api Module (Customer APIs)**
- Customer authentication and registration (OTP-based)
- Restaurant discovery and search
- Food menu browsing
- Cart management
- Order placement and tracking
- Wallet operations (redeem, withdraw)
- Review and rating submission
- Wishlist management

**2. Restaurant Module (Restaurant APIs)**
- Restaurant executive authentication (OTP-based)
- Order management (accept, reject, update status)
- Menu management operations
- Table management for dine-in
- Payment type selection
- Sales data export
- KOT (Kitchen Order Ticket) and estimation printing
- Dynamic pricing updates

**3. Admin Module (Tally Integration)**
- Order data export to Tally
- Daily log generation
- Weekly payout data export
- Invoice payout data export
- Mark records as checked/synced

### Trust Boundaries

**Client (Mobile Apps) ↔ Backend**
- Customers authenticate via OTP + Passport tokens
- Restaurants authenticate via OTP + Passport tokens
- All authenticated requests require valid Bearer tokens
- Guest endpoints have no authentication requirement

**Backend ↔ External Services**
- SMS service (prutech.org) for OTP delivery
- Google Maps API for distance/route calculations
- Firebase for push notifications (implied, not explicitly seen in auth files)

**Admin/Tally ↔ Backend**
- Tally integration uses Bearer token authentication from config
- Admin panel uses session-based authentication (web routes, not API)

---

## 2. AUTHENTICATION & AUTHORIZATION

### Authentication Mechanisms

**1. Customer Authentication (Guard: `api`)**
- **Driver:** Laravel Passport
- **Provider:** `customer_users` → Model: `Modules\Admin\Entities\User`
- **Flow:**
  1. POST `/login` with `mobile_number` → OTP generated and sent via SMS
  2. POST `/verify-user` with `otp`, `mobile_number` + headers `Device-Token`, `Device-Type` → Access token issued
  3. For new users: POST `/Register-user` with `user_id`, `name`, `email` (optional `referral_code`)
  4. Access token stored with `role = 'customer'` in `oauth_access_tokens` table
  5. Device session tracked in `user_devices` table with `user_type = 'customer'`

**2. Restaurant Authentication (Guard: `restaurant`)**
- **Driver:** Laravel Passport
- **Provider:** `restaurant_users` → Model: `Modules\Admin\Entities\RestaurantExecutives`
- **Flow:**
  1. POST `/restaurant/login` with `mobile_number` → OTP generated for all active restaurant executives with that phone
  2. Returns `hotel_list` array of restaurants user can access
  3. POST `/restaurant/verify-user` with `otp`, `mobile_number`, `hotel_id` + headers `Device-Token`, `Device-Type` → Access token issued
  4. Access token stored with `role = 'hotel'` in `oauth_access_tokens` table
  5. Device session tracked in `user_devices` table with `user_type = 'restaurant'`

**3. Tally API Authentication**
- **Middleware:** `tallyapi` (RequestTallyMiddleware)
- **Method:** Bearer token from `config('app.TBEARERTOKEN')`
- **No user model association** - stateless token check only

**4. Admin Authentication**
- **Guard:** `admin` (session-based)
- **Provider:** `admins` → Model: `Modules\Admin\Entities\AdminUser`
- **NOT PART OF API CONTRACT** - web routes only

### Token Lifecycle and Revocation

**Customer Token Lifecycle:**
- Token created on successful OTP verification: `$user->createToken('API Token')->accessToken`
- Previous tokens with `role = 'customer'` for same user are revoked on new login
- Token manually revoked on logout: `Auth::user()->token()->revoke()`
- Device session marked with `logout_time` on logout

**Restaurant Token Lifecycle:**
- Token created on successful OTP verification: `$user->createToken('API Token')->accessToken`
- Previous tokens with `role = 'hotel'` for same user are revoked on new login
- Token manually revoked on logout: `Auth::user()->token()->revoke()`
- Device session marked with `logout_time` on logout

**Token Expiration:** NOT DEFINED IN CODE - Default Passport expiration applies (typically 1 year if not configured)

### Authorization Enforcement

**Middleware Stack:**
1. **`auth:api`** - Validates Passport token for customer guard
2. **`checkUserStatus`** - Validates `user.status == 1` for authenticated customer
3. **`auth:restaurant`** - Validates Passport token for restaurant guard  
4. **`CheckHotelUserStatus`** - Validates `user.status == 1` for authenticated restaurant executive
5. **`tallyapi`** - Validates Bearer token matches config value

**Authorization Checks in Code:**
- Restaurant endpoints implicitly filter by `Auth::guard('restaurant')->user()->hotelId` (accessed via relationships)
- Customer endpoints implicitly filter by `Auth::guard('api')->user()->id`
- No explicit role-based access control (RBAC) found in API code
- Restaurant executives can access any restaurant data if their `hotelId` matches (no cross-restaurant validation found)

### Explicit Assumptions

1. **OTP Expiration:** Customer OTP expires after 3 minutes (hardcoded check: `$minutes > 3`). Restaurant OTP expiration check is commented out in code - **NOT DEFINED IN CODE** for restaurant.

2. **Device Token:** Required header `Device-Token` must be present for login/verify endpoints. Missing token returns error: "Device Token Required: Please restart your app!"

3. **Special Test Numbers:**
   - Customer: `1111111111` → OTP: `111111` (bypasses SMS)
   - Restaurant: `2222222222` → OTP: `222222` (bypasses SMS)

4. **User Status:** Users with `status == 0` cannot authenticate or access protected endpoints (enforced by middleware)

5. **Restaurant Approval:** Restaurant executives can only login if:
   - `restaurant_executives.status == 1`
   - `restaurants.status == 1`
   - `restaurant_settings.status == 1`
   - `restaurants.is_approved == 1`

---

## 3. API CONTRACT

### Base URL Structure
- Customer APIs: `/api/...`
- Restaurant APIs: `/api/restaurant/...`
- Guest APIs: `/api/...Guest` (suffix)
- Tally APIs: `/api/...` (under `tallyapi` middleware group)

### Response Format
All APIs return JSON with structure:
```json
{
  "ErrorCode": 0|1,
  "Data": {...}|(object){},
  "Message": "string",
  "Toast": true|false
}
```

---

### CUSTOMER AUTHENTICATION APIs

#### **POST /api/login**
- **Purpose:** Initiate customer login by sending OTP to mobile number
- **Who can call:** Public (no authentication required)
- **Authentication required:** No
- **Required headers:** None
- **Request body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| mobile_number | numeric | Yes | `required\|numeric` |

- **Optional fields:** None
- **Implicit inputs:** None
- **Validation rules enforced:**
  - `mobile_number` must be numeric
  - If user exists and `status == 0`, returns "Inactive User!"
- **Data source used:**
  - `users` table (creates new user if not exists)
  - `otps` table (creates/updates OTP record)
- **Response fields (success):**
  - `ErrorCode`: 0
  - `Data.otp`: string (OTP number, "111111" for test number)
  - `Data.mobile_number`: string
  - `Data.user_id`: integer
  - `Message`: "Success"
  - `Toast`: false
- **Failure conditions:**
  - Validation failure: `ErrorCode: 1`, `Data`: validator messages, `Toast`: true
- **Data exposure notes:** PII (phone number), OTP (should not be exposed in production - present in response)

#### **POST /api/verify-user**
- **Purpose:** Verify OTP and authenticate customer, issue access token
- **Who can call:** Public (must have received OTP from /login)
- **Authentication required:** No
- **Required headers:**

| Header | Required | Purpose |
|--------|----------|---------|
| Device-Token | Yes | Device identifier for session tracking |
| Device-Type | No | Device type (1=Android, 2=iOS implied but not validated) |

- **Request body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| otp | numeric | Yes | `required\|numeric` |
| mobile_number | numeric | Yes | `required\|numeric` |

- **Optional fields:** None
- **Implicit inputs:** None
- **Validation rules enforced:**
  - OTP must match stored OTP in `otps` table
  - OTP must not be expired (>3 minutes since `updated_at`)
  - User must exist
  - If user `status == 0` and `name` is set, returns "Inactive User!"
- **Data source used:**
  - `users` table
  - `otps` table
  - `oauth_access_tokens` table (token creation)
  - `user_devices` table (session creation)
- **Response fields (success for existing user):**
  - `ErrorCode`: 0
  - `Data.user_id`: integer
  - `Data.name`: string (empty string if not set)
  - `Data.email`: string (empty string if not set)
  - `Data.mobile_number`: string
  - `Data.is_existing`: boolean (true if name is set, false otherwise)
  - `Data.token`: string (Passport access token - only if existing user)
  - `Message`: "Success"
  - `Toast`: false
- **Response fields (success for new user):**
  - Same as above but `is_existing`: false, `token`: NOT PRESENT
- **Failure conditions:**
  - Missing Device-Token header: `ErrorCode: 1`, `Message`: "Device Token Required: Please restart your app!"
  - Invalid user: `ErrorCode: 1`, `Message`: "Invalid user"
  - No OTP generated: `ErrorCode: 1`, `Message`: "No OTP Generated!"
  - Invalid OTP: `ErrorCode: 1`, `Message`: "Invalid OTP"
  - OTP timeout: `ErrorCode: 1`, `Message`: "Time Out" (after 3 minutes)
  - Inactive user: `ErrorCode: 1`, `Message`: "Inactive User!"
- **Data exposure notes:** PII (user data), Access token
- **State changes:**
  - Revokes all previous customer tokens for user
  - Marks previous device sessions with `logout_time`
  - Creates new Passport token with `role = 'customer'`
  - Creates/updates device session
  - If `customer_id` is null, generates format: `NC{7-digit}` (base: 24000000 + user_id)
  - Sets `otp.status = 1` (marks OTP as used)

#### **POST /api/Register-user**
- **Purpose:** Complete registration for new customer after OTP verification
- **Who can call:** Public (typically called after verify-user when `is_existing == false`)
- **Authentication required:** No (note: commented code suggests user_id validation was considered)
- **Required headers:**

| Header | Required | Purpose |
|--------|----------|---------|
| Device-Token | No | Device identifier (used if present) |
| Device-Type | No | Device type (used if present) |

- **Request body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| user_id | numeric | Yes | `required\|numeric` |
| name | string | Yes | `required` |
| email | string | Yes | `required` |

- **Optional fields:**

| Field | Type | Notes |
|-------|------|-------|
| referral_code | string | If provided, must exist in users table as `referal_code` |

- **Implicit inputs:** None
- **Validation rules enforced:**
  - `user_id` must exist in `users` table
  - `email` must be unique (cannot already exist)
  - If `referral_code` provided and invalid: `ErrorCode: 1`, `Message`: "Invalid Referral Code!"
- **Data source used:**
  - `users` table (update existing user record)
  - `general_settings` table (for referral credit amount)
  - `wallets` table (creates credit entry for referrer if referral_code valid)
  - `oauth_access_tokens` table (token creation)
  - `user_devices` table (session creation)
- **Response fields (success):**
  - `ErrorCode`: 0
  - `Data.user_id`: integer
  - `Data.name`: string
  - `Data.email`: string
  - `Data.mobile_number`: string
  - `Data.is_existing`: true (always true after registration)
  - `Data.token`: string (Passport access token)
  - `Message`: "Success"
  - `Toast`: false
- **Failure conditions:**
  - Validation failure: `ErrorCode: 1`, `Data`: validator messages, `Toast`: true
  - Email already exists: `ErrorCode: 1`, `Message`: "This Email is Already Registered!"
  - Invalid referral code: `ErrorCode: 1`, `Message`: "Invalid Referral Code!"
- **Data exposure notes:** PII (user data), Access token
- **State changes:**
  - Updates user with name, email, `customer_id` (format: `NC{7-digit}`)
  - Sets `user.status = 1`
  - If referral_code valid: creates wallet credit for referrer (`type = 3`, `redeem_status = 1`, amount from `general_settings.referal_credit`)
  - Sets `user.refered_by` to referrer user_id
  - Creates Passport token
  - Creates/updates device session

#### **POST /api/resendOtp**
- **Purpose:** Resend OTP for customer login
- **Who can call:** Public
- **Authentication required:** No
- **Required headers:** None
- **Request body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| mobile_number | numeric | Yes | `required\|numeric` |
| user_id | numeric | Yes | `required\|numeric` |

- **Optional fields:** None
- **Implicit inputs:** None
- **Validation rules enforced:**
  - User must exist
  - OTP not resent if last OTP was within 3 minutes (reuses same OTP)
- **Data source used:**
  - `users` table
  - `otps` table (updates existing OTP or creates new)
- **Response fields (success):**
  - `ErrorCode`: 0
  - `Data.otp`: string (OTP number)
  - `Data.user_id`: integer
  - `Message`: "success"
  - `Toast`: false
- **Failure conditions:**
  - Validation failure: `ErrorCode: 1`, `Data`: (object){}, `Message`: validator messages, `Toast`: true
- **Data exposure notes:** PII (OTP exposed in response - security concern)
- **State changes:**
  - Updates OTP in `otps` table (or creates new if >3 minutes old)
  - Sends SMS via external service

#### **POST /api/logout**
- **Purpose:** Logout customer and revoke access token
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:**

| Header | Required | Purpose |
|--------|----------|---------|
| Device-Token | Yes | Device identifier |
| Device-Type | No | Device type |

- **Request body:** NO REQUEST BODY REQUIRED
- **Implicit inputs:**
  - Authenticated user from `Auth::guard('api')->user()`
- **Validation rules enforced:**
  - Device token must be provided (returns error if empty)
  - User must be authenticated
- **Data source used:**
  - `user_devices` table (updates logout_time)
  - `oauth_access_tokens` table (revokes token)
- **Response fields (success):**
  - `ErrorCode`: 0
  - `Data`: (object){}
  - `Message`: "Success"
- **Failure conditions:**
  - Missing Device-Token: `ErrorCode: 1`, `Message`: "Device Token Required!", `Toast`: true
  - Invalid User: `ErrorCode: 1`, `Message`: "Invalid User!", `Toast`: true
- **Data exposure notes:** None
- **State changes:**
  - Sets `user_devices.logout_time = current timestamp` for matching device
  - Revokes Passport token via `Auth::user()->token()->revoke()`

#### **GET /api/notAuthorized**
- **Purpose:** Return unauthorized error response
- **Who can call:** Public (typically called by middleware)
- **Authentication required:** No
- **Required headers:** None
- **Request body:** NO REQUEST BODY REQUIRED
- **Response fields:**
  - `ErrorCode`: 1
  - `Data`: (object){}
  - `Message`: "Invalid User!"
  - `Toast`: true
  - HTTP Status: 401
- **Data exposure notes:** None

---

### CUSTOMER PROFILE & BASIC DATA APIs

#### **POST /api/Get-basic-image**
- **Purpose:** Get onboarding/login/verify OTP banner images
- **Who can call:** Public
- **Authentication required:** No
- **Required headers:** None
- **Request body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| type | integer/string | Yes | NOT DEFINED IN CODE (expected: 1=onboarding, 2=login, 3=Verify OTP based on response) |

- **Optional fields:** None
- **Implicit inputs:** None
- **Validation rules enforced:** None found in code
- **Data source used:**
  - `banner_images` table filtered by `type` and `userType = 'customer'`
- **Response fields (success):**
  - `Document`: "type=> 1.onboarding, 2.login, 3.Verify OTP"
  - `ErrorCode`: 0
  - `Data`: array of objects with `image` (full URL) and `content.title`, `content.description`
  - `Message`: "Success"
  - `Toast`: false
- **Failure conditions:**
  - No images found: `ErrorCode: 1`, `Data`: (object){}, `Message`: "No Images!", `Toast`: true
- **Data exposure notes:** Public image URLs

#### **POST /api/Get-basic-data**
- **Purpose:** Get customer app initialization data
- **Who can call:** Public
- **Authentication required:** No
- **Required headers:** None
- **Request body:** NO REQUEST BODY REQUIRED
- **Implicit inputs:** None
- **Validation rules enforced:** None
- **Data source used:**
  - `general_settings` table
- **Response fields (success):**
  - `ErrorCode`: 0
  - `Data.user.name`: string
  - `Data.user.email`: string
  - `Data.user.mobile_number`: string
  - `Data.user.address`: string
  - `Data.contact_us.title`: string
  - `Data.contact_us.description`: string
  - `Data.contact_us.email`: string
  - `Data.contact_us.mobile`: string
  - `Data.contact_us.whatsapp`: string (prefixed with "+91")
  - `Data.web_view.terms_and_conditions`: URL string
  - `Data.web_view.privacy_policy`: URL string
  - `Data.web_view.about`: URL string
  - `Data.notification_count`: integer (always 0 for unauthenticated)
  - `Data.isLiveOrder`: boolean (always false for unauthenticated)
  - `Message`: "Success"
  - `Toast`: false
- **Failure conditions:** None found in code
- **Data exposure notes:** Contact information (may be PII depending on content)

#### **POST /api/get-home**
- **Purpose:** Get customer home screen data with banners and notifications
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:** NO REQUEST BODY REQUIRED
- **Implicit inputs:**
  - Authenticated user from `Auth::guard('api')->user()`
- **Validation rules enforced:** None
- **Data source used:**
  - `banner_images` table (`type = 4`, `userType = 'customer'`)
  - `carts` table (count for authenticated user)
  - `orders` table (check for live orders)
  - `notifications` table (count unread)
- **Response fields:** NOT FULLY DEFINED IN CODE (controller method too large to fully extract). Known fields:
  - `ErrorCode`: 0
  - `Data.slider`: array of banner images
  - `Data.cart_count`: integer
  - `Message`: "Success"
  - `Toast`: false
- **Failure conditions:** None explicitly defined
- **Data exposure notes:** User-specific data (cart count, orders)

---

### CUSTOMER ORDER APIs

#### **POST /api/get-myorders**
- **Purpose:** Get list of customer orders with pagination
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| order_type | integer/string | Yes | NOT DEFINED IN CODE (expected values from response analysis: appears to filter by order status) |
| page_no | integer | No | Defaults to 1 |
| per_page | integer | No | Defaults to NOT DEFINED IN CODE |

- **Optional fields:** None found
- **Implicit inputs:**
  - Authenticated user ID from `Auth::guard('api')->user()->id`
- **Validation rules enforced:** None found in code
- **Data source used:**
  - `orders` table filtered by `userId = authenticated_user_id`
- **Response fields:** NOT FULLY DEFINED IN CODE (controller very large). Expected structure:
  - `ErrorCode`: 0|1
  - `Data`: array of order objects with status, restaurant info, items
  - `Message`: string
  - `Toast`: boolean
- **Failure conditions:** NOT DEFINED IN CODE
- **Data exposure notes:** Order history (financial data, PII)

#### **POST /api/order-details**
- **Purpose:** Get detailed information for a specific order
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| order_id | integer/string | Yes | NOT DEFINED IN CODE (appears required based on usage) |

- **Optional fields:** None found
- **Implicit inputs:**
  - Authenticated user ID (validates order belongs to user)
- **Validation rules enforced:**
  - Order must belong to authenticated user
- **Data source used:**
  - `orders` table with relationships: `getOrderItems`, `getRestaurant`, `getOrderStatus`
  - `restaurant_reviews` table (check if review exists)
  - `order_items` table
- **Response fields:** NOT FULLY DEFINED IN CODE (controller method very large). Known fields include:
  - Order status information
  - Restaurant details
  - Order items with pricing
  - Payment information
  - Cancellation details (if applicable)
  - Review eligibility (`add_review`: boolean)
- **Failure conditions:**
  - Order not found or not owned by user
- **Data exposure notes:** Full order details (financial, PII, restaurant info)

#### **POST /api/confirm-order**
- **Purpose:** Customer confirms order after restaurant acceptance (for dine-in/takeaway flows)
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| order_id | integer/string | Yes | NOT DEFINED IN CODE |

- **Optional fields:** None found
- **Implicit inputs:**
  - Authenticated user ID
- **Validation rules enforced:**
  - Order must exist
  - Order must belong to user
  - Order status must be valid for confirmation (NOT FULLY DEFINED - appears to check `order_status == 2`)
- **Data source used:**
  - `orders` table
- **Response fields:** NOT FULLY DEFINED IN CODE
- **Failure conditions:**
  - Order not found: `ErrorCode: 1`, `Message`: "Invalid Order!"
  - Order already cancelled (`order_status == 5`): `ErrorCode: 1`, `Message`: "Order Already Cancelled!"
  - Order already rejected (`order_status == 6`): `ErrorCode: 1`, `Message`: "Order Already Rejected!"
  - Order already completed (`order_status == 4`): `ErrorCode: 1`, `Message`: "Order Already Completed!"
- **Data exposure notes:** Order status
- **State changes:**
  - Sets `order.order_status = 2` (Accepted/Live)
  - Sets `order.food_status = 1` (KOT Waiting)
  - Sets `order.status = 1` (user placed)
  - Sets `order.accepted_reason` if provided (NOT DEFINED - code shows `$note` variable)

#### **POST /api/cancel_order**
- **Purpose:** Customer cancels an order
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| order_id | integer/string | Yes | NOT DEFINED IN CODE |
| cancelled_reason | string | Yes | NOT DEFINED IN CODE (appears required based on usage) |
| cancelled_description | string | No | NOT DEFINED IN CODE |

- **Optional fields:** `cancelled_description` (appears optional)
- **Implicit inputs:**
  - Authenticated user ID
- **Validation rules enforced:**
  - Order must exist and belong to user
  - Order cannot be in status 6 (rejected) or 4 (completed)
  - Order must be in status 2 or 3 to cancel
- **Data source used:**
  - `orders` table
- **Response fields (success):**
  - `ErrorCode`: 0
  - `Data`: (object){}
  - `Message`: "Success"
  - `Toast`: false
- **Failure conditions:**
  - Order already rejected: `ErrorCode: 1`, `Message`: "Order Already Rejected!"
  - Order already completed: `ErrorCode: 1`, `Message`: "Order Already Completed!"
- **Data exposure notes:** None
- **State changes:**
  - Sets `order.order_status = 5` (Cancelled)
  - Sets `order.food_status = 3`
  - Sets `order.status = 1`
  - Sets `order.cancelled_reason` and `order.cancelled_description`
  - Sets `order.contactPerm` (NOT DEFINED - appears in code but source unclear)

---

### CUSTOMER CART & CHECKOUT APIs

#### **POST /api/add-to-cart**
- **Purpose:** Add food item to customer cart
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:** NOT FULLY DEFINED IN CODE (controller method very large). Expected fields based on database schema:

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| productId | integer | Yes | NOT DEFINED IN CODE |
| hotelId | integer | Yes | NOT DEFINED IN CODE |
| quantity | integer | Yes | NOT DEFINED IN CODE |

- **Optional fields:** Variant selections, addons (NOT DEFINED IN CODE - structure unclear)
- **Implicit inputs:**
  - Authenticated user ID
- **Validation rules enforced:**
  - Restaurant must be active (`status == 1`, `is_approved == 1`, `app_view == '1'`)
  - Food item must exist and be active
  - Cart can only contain items from one restaurant (NOT DEFINED - validation may exist)
- **Data source used:**
  - `carts` table
  - `menus` table (validate food item)
  - `restaurants` table (validate restaurant)
- **Response fields:** NOT FULLY DEFINED IN CODE
- **Failure conditions:** NOT DEFINED IN CODE
- **Data exposure notes:** Cart contents
- **State changes:**
  - Creates or updates `carts` record with `userId`, `productId`, `hotelId`, `quantity`

#### **POST /api/get-cart**
- **Purpose:** Get customer cart contents with item details
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:** NO REQUEST BODY REQUIRED
- **Implicit inputs:**
  - Authenticated user ID
- **Validation rules enforced:** None
- **Data source used:**
  - `carts` table filtered by `userId`
  - `menus` table (item details via relationship)
  - `restaurants` table (restaurant details)
  - `product_variants` table (variant options)
- **Response fields:** NOT FULLY DEFINED IN CODE (very large controller method). Expected includes:
  - Cart items with pricing
  - Restaurant information
  - Subtotal, taxes, fees
  - Total amount
- **Failure conditions:** None found
- **Data exposure notes:** Cart contents, pricing

#### **POST /api/checkout**
- **Purpose:** Initiate checkout process, calculate final bill with taxes and fees
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:** NOT FULLY DEFINED IN CODE. Expected fields:

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| redeem | boolean | No | Whether to use wallet balance |
| charity | numeric | No | Charity amount |
| tips | numeric | No | Tips amount |
| noofpersons | integer | No | Number of persons (for dine-in) |
| reserve_table | integer | No | Table ID (if table reservation) |
| timeOfArrival | string | No | Arrival time |
| orderInstructions | string | No | Special instructions |
| dineinOrTakeaway | integer | Yes | NOT DEFINED IN CODE (1=dine-in, 2=takeaway implied) |

- **Optional fields:** Multiple (see above)
- **Implicit inputs:**
  - Authenticated user ID
  - User's cart contents
  - User's wallet balance
- **Validation rules enforced:**
  - Cart must not be empty
  - Restaurant must be active
  - Wallet balance sufficient if redeem enabled
- **Data source used:**
  - `carts` table
  - `menus` table
  - `restaurants` table
  - `restaurant_settings` table (for GST, packing charges, etc.)
  - `general_settings` table (for convenience fee, charity settings)
  - `users` table (wallet balance)
- **Response fields:** NOT FULLY DEFINED IN CODE. Known includes:
  - Bill breakdown (item total, GST, convenience fee, charity, tips, packing fee)
  - Final total
  - Redeemable wallet amount
  - Restaurant details
- **Failure conditions:** NOT DEFINED IN CODE
- **Data exposure notes:** Financial calculations, wallet balance

#### **POST /api/complete-checkout**
- **Purpose:** NOT DEFINED IN CODE - method exists but implementation unclear from route analysis
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Request body:** NOT DEFINED IN CODE

#### **POST /api/complete_cart**
- **Purpose:** Complete cart and create order
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:** NOT FULLY DEFINED IN CODE (very large method). Expected includes all checkout fields plus:
  - Payment method selection
  - Final amounts
- **Implicit inputs:**
  - Authenticated user
  - Cart contents
- **Validation rules enforced:** NOT FULLY DEFINED
- **Data source used:**
  - `orders` table (create new order)
  - `order_items` table (create items)
  - `carts` table (clear after order creation)
  - `wallets` table (debit if wallet used)
  - `users` table (update wallet balance)
- **Response fields:** NOT FULLY DEFINED IN CODE
- **Failure conditions:** NOT DEFINED IN CODE
- **Data exposure notes:** Order creation, wallet debit
- **State changes:**
  - Creates order with `order_status = 3` (Pending), `status = 1`
  - Creates order items
  - If wallet redeem: debits wallet, creates wallet transaction record (`type = 4`, `redeem_status = 3`)
  - Clears user's cart
  - Sends push notifications to restaurant staff

#### **POST /api/clear-cart**
- **Purpose:** Clear all items from customer cart
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:** NO REQUEST BODY REQUIRED
- **Implicit inputs:**
  - Authenticated user ID
- **Validation rules enforced:** None
- **Data source used:**
  - `carts` table (delete records for user)
- **Response fields:** NOT DEFINED IN CODE
- **Failure conditions:** None
- **Data exposure notes:** None
- **State changes:**
  - Deletes all cart records for user

#### **POST /api/cart_count**
- **Purpose:** Get count of items in customer cart
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:** NO REQUEST BODY REQUIRED
- **Implicit inputs:**
  - Authenticated user ID
- **Validation rules enforced:** None
- **Data source used:**
  - `carts` table (count records for user)
- **Response fields:** NOT DEFINED IN CODE (expected: cart count integer)
- **Failure conditions:** None
- **Data exposure notes:** Cart metadata

---

### CUSTOMER WALLET APIs

#### **POST /api/my_wallet**
- **Purpose:** Get customer wallet balance and transaction history
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:** NOT DEFINED IN CODE (method signature unclear from route analysis)
- **Implicit inputs:**
  - Authenticated user ID
- **Validation rules enforced:** None found
- **Data source used:**
  - `users` table (`wallet_balance` field)
  - `wallets` table (transaction history)
- **Response fields:** NOT DEFINED IN CODE (expected: balance and transaction list)
- **Failure conditions:** None
- **Data exposure notes:** Financial data (wallet balance, transaction history)

#### **POST /api/wallet-redeem**
- **Purpose:** NOT DEFINED IN CODE - method exists but implementation unclear. Possibly enable/disable wallet redeem option.
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Request body:** NOT DEFINED IN CODE

#### **POST /api/wallet-withdraw**
- **Purpose:** Request withdrawal of wallet balance to bank account
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| name | string | Yes | `required` |
| mobile | string | Yes | `required` |
| email | string | Yes | `required` |
| account_number | string | Yes | `required` |
| ifsc | string | Yes | `required` |
| amount | numeric | Yes | `required` |

- **Optional fields:** None
- **Implicit inputs:**
  - Authenticated user ID
  - User's wallet balance from `users.wallet_balance`
- **Validation rules enforced:**
  - Amount must not exceed wallet balance
  - Amount must meet minimum withdrawal (from `general_settings.redeem_amount`)
- **Data source used:**
  - `users` table (wallet balance)
  - `general_settings` table (minimum withdraw amount)
  - `wallet_redeems` table (create withdrawal request)
  - `wallets` table (create debit transaction)
- **Response fields (success):**
  - `ErrorCode`: 0
  - `Data`: (object){}
  - `Message`: "Success"
  - `Toast`: false
- **Failure conditions:**
  - Validation failure: `ErrorCode: 1`, `Message`: validator messages, `Toast`: true
  - Insufficient balance: `ErrorCode: 1`, `Message`: "Insufficient Balance Amount!", `Toast`: true
  - Below minimum: `ErrorCode: 1`, `Message`: "Minimum Withdraw Amount is {amount}!", `Toast`: true
- **Data exposure notes:** PII (bank account details), Financial data
- **State changes:**
  - Creates `wallet_redeems` record with `status = 1` (pending)
  - Creates `wallets` debit record (`status = 2`, `type = 1`, `redeem_status = 1`)
  - Deducts amount from `users.wallet_balance`

#### **POST /api/redeem_history**
- **Purpose:** Get history of wallet withdrawal requests
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:** NOT DEFINED IN CODE
- **Implicit inputs:**
  - Authenticated user ID
- **Validation rules enforced:** None
- **Data source used:**
  - `wallet_redeems` table filtered by `userId`
- **Response fields:** NOT DEFINED IN CODE (expected: array of withdrawal requests with status)
- **Failure conditions:** None
- **Data exposure notes:** Financial transaction history

---

### CUSTOMER RESTAURANT DISCOVERY APIs

#### **POST /api/Restaurant**
- **Purpose:** Get restaurant details by ID
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| id | integer | Yes | NOT DEFINED IN CODE (appears required based on usage) |

- **Optional fields:** None found
- **Implicit inputs:**
  - Authenticated user ID (for wishlist check, distance calculation if user has location)
  - User location from `users.latitude`, `users.longitude` if available
- **Validation rules enforced:**
  - Restaurant must exist
  - Restaurant must be approved and active (`is_approved == 1`, `status == 1`, `app_view == '1'`, `admin_status_control == 1`)
- **Data source used:**
  - `restaurants` table
  - `restaurant_settings` table
  - `restaurant_image_gallery` table
  - `restaurant_video_gallery` table
  - `restaurant_reviews` table (ratings)
  - `wishlist_restaurants` table (check if favorited)
- **Response fields:** NOT FULLY DEFINED IN CODE (very large method). Known includes:
  - Restaurant basic info (name, address, type)
  - Images and videos
  - Rating and review count
  - Distance from user
  - Availability status
  - Menu categories
  - Features
  - Dining areas (if applicable)
- **Failure conditions:**
  - Restaurant not found or inactive
- **Data exposure notes:** Restaurant business information, location data

#### **POST /api/search**
- **Purpose:** Search restaurants or dishes with filters
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| id | integer | Yes | `required` (1=Restaurant search, 2=Dish search) |
| search_key | string | No | Search query string |
| lat | float | No | User latitude (defaults to user's saved location or 9.591402035843934) |
| lng | float | No | User longitude (defaults to user's saved location or 76.52264442992801) |
| page_no | integer | No | Defaults to 1 |
| per_page | integer | No | Defaults to 15 |
| filter | object | No | Filter object structure NOT FULLY DEFINED IN CODE |

- **Optional fields:** `search_key`, `lat`, `lng`, `page_no`, `per_page`, `filter`
- **Implicit inputs:**
  - Authenticated user ID
  - User location from `users` table if `lat`/`lng` not provided
- **Validation rules enforced:**
  - If `search_key` empty, returns recent searches
- **Data source used:**
  - `restaurants` table (for restaurant search)
  - `menus` table (for dish search)
  - `restaurant_settings` table
  - `restaurant_reviews` table (ratings)
  - `wishlist_restaurants` table
  - `wishlist_foods` table
  - `user_food_searches` table (save search history)
- **Response fields (success):**
  - `ErrorCode`: 0
  - `Data.last_page`: boolean
  - `Data.per_page`: integer
  - `Data.total_page`: integer
  - `Data.current_page`: integer
  - `Data.categories`: array (id, selected, title)
  - `Data.item`: array of restaurant/dish objects with details
  - `Message`: "Success" or "No Items Found!"
  - `Toast`: false
- **Response fields (empty search_key - recent searches):**
  - `ErrorCode`: 0
  - `Data.recent_search`: array of strings (recent search terms)
  - `Message`: ""
  - `Toast`: true
- **Failure conditions:**
  - Validation failure: `ErrorCode: 1`, `Data`: (object){}, `Message`: validator messages, `Toast`: true
- **Data exposure notes:** Search history, restaurant/dish data
- **State changes:**
  - Saves search term to `user_food_searches` table (asynchronously, after response)

#### **POST /api/get-hotels-map**
- **Purpose:** Get restaurant markers for map view with route-based filtering
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| near_by | boolean | Yes | If true: single location search, if false: route-based search |
| from | object | Yes | `{lat: float, lng: float, location: string}` |
| to | object | No | Required if `near_by == false` - `{lat: float, lng: float, location: string}` |
| search_key | string | No | NOT DEFINED IN CODE |
| filter | object | No | Filter object (structure NOT DEFINED) |
| selected_polyline | string | No | Selected route polyline (for route search) |
| all_polyline | array | No | All route polylines (for route search) |

- **Optional fields:** Multiple (see above)
- **Implicit inputs:**
  - Authenticated user ID
  - User location from `users` table
- **Validation rules enforced:**
  - For `near_by == true`: searches within 10km radius
  - For `near_by == false`: searches along route polyline within distance threshold
- **Data source used:**
  - `restaurants` table
  - `restaurant_settings` table
  - `restaurant_reviews` table
  - `user_searches` table (saves location searches)
  - Google Maps Directions API (for route calculation if polyline not provided)
- **Response fields (near_by == true):**
  - `ErrorCode`: 0
  - `Data.place_markers`: array of `{id, restaurant_id, title, lat, lng, availability, nextAvailable}`
  - `Toast`: false
  - `Message`: "Success"
- **Response fields (near_by == false):**
  - `ErrorCode`: 0
  - `Data.encodedPolyline`: array of `{polyline: string, position: integer}`
  - `Data.place_markers`: array (same structure as above)
  - `Toast`: false
  - `Message`: "Success"
- **Failure conditions:** None explicitly defined
- **Data exposure notes:** Location data, restaurant locations
- **State changes:**
  - Saves location searches to `user_searches` table (replaces existing entries for same location)

#### **POST /api/get-hotelslist-map**
- **Purpose:** Get paginated restaurant list with map markers
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| near_by | boolean | Yes | Search type |
| from | object | Yes | `{lat: float, lng: float}` |
| page_no | integer | No | Defaults to 1 |
| per_page | integer | No | Defaults to 10 |
| restaurant_search_key | string | No | Search filter for restaurant name |
| encodedPolyline | string | No | Route polyline (if not near_by) |
| filter | object | No | Filter object |

- **Optional fields:** Multiple (see above)
- **Implicit inputs:**
  - Authenticated user ID
  - User location
- **Validation rules enforced:** None explicitly defined
- **Data source used:**
  - Same as `get-hotels-map` but with pagination
- **Response fields:**
  - `ErrorCode`: 0
  - `Data.items`: array of restaurant objects with full details
  - `Data.per_page`: integer
  - `Data.total_page`: integer
  - `Data.current_page`: integer
  - `Data.last_page`: boolean
  - `Message`: "Success"
  - `Toast`: false
- **Failure conditions:** None
- **Data exposure notes:** Restaurant listings, location data

---

### CUSTOMER REVIEW & RATING APIs

#### **POST /api/review**
- **Purpose:** Get restaurant reviews
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| id | integer | Yes | Restaurant ID (NOT DEFINED IN CODE - appears required) |

- **Optional fields:** None found
- **Implicit inputs:** None
- **Validation rules enforced:** None
- **Data source used:**
  - `restaurant_reviews` table filtered by `hotelId` and `type = 3` (restaurant reviews)
- **Response fields:** NOT DEFINED IN CODE (expected: array of review objects)
- **Failure conditions:** None
- **Data exposure notes:** User-generated content (reviews)

#### **POST /api/rate-and-review**
- **Purpose:** NOT DEFINED IN CODE - method exists but implementation unclear. Possibly initiate review flow.
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Request body:** NOT DEFINED IN CODE

#### **POST /api/submit-review**
- **Purpose:** Submit review and rating for completed order
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:** NOT FULLY DEFINED IN CODE (method very large). Expected fields:

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| order_id | integer | Yes | NOT DEFINED IN CODE |
| ratings | integer/float | Yes | NOT DEFINED IN CODE (expected: 1-5) |
| review | string | No | Review text |

- **Optional fields:** `review`, possibly food item ratings (NOT DEFINED)
- **Implicit inputs:**
  - Authenticated user ID
- **Validation rules enforced:**
  - Order must exist and belong to user
  - Order must be in status 4 (completed)
  - Review must not already exist for this order
- **Data source used:**
  - `restaurant_reviews` table (create review records)
  - `orders` table (mark `review_done = 1`)
  - `order_items` table (if food item reviews)
- **Response fields:** NOT DEFINED IN CODE
- **Failure conditions:**
  - Order not found or not owned by user
  - Order not completed
  - Review already submitted
- **Data exposure notes:** User-generated content
- **State changes:**
  - Creates `restaurant_reviews` records (`type = 3` for restaurant, `type = 2` for food items if applicable)
  - Sets `orders.review_done = 1`

#### **POST /api/get-review-reply**
- **Purpose:** Get restaurant's reply to customer review
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| id | integer | Yes | Review ID (NOT DEFINED IN CODE) |

- **Optional fields:** None
- **Implicit inputs:** None
- **Validation rules enforced:** None
- **Data source used:**
  - `restaurant_reviews` table (get `reply` field)
- **Response fields:** NOT DEFINED IN CODE (expected: reply text)
- **Failure conditions:** None
- **Data exposure notes:** Review replies

---

### CUSTOMER WISHLIST APIs

#### **POST /api/add-to-wishlist**
- **Purpose:** Add restaurant or food item to wishlist
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:** NOT DEFINED IN CODE (expected: restaurant_id or food_id, type indicator)
- **Implicit inputs:**
  - Authenticated user ID
- **Validation rules enforced:** None found
- **Data source used:**
  - `wishlist_restaurants` table or `wishlist_foods` table
- **Response fields:** NOT DEFINED IN CODE
- **Failure conditions:** None
- **Data exposure notes:** User preferences
- **State changes:**
  - Creates wishlist record or removes if already exists (toggle behavior implied)

#### **POST /api/wishlist**
- **Purpose:** Get list of wishlisted restaurants
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:** NO REQUEST BODY REQUIRED (or pagination params NOT DEFINED)
- **Implicit inputs:**
  - Authenticated user ID
- **Validation rules enforced:** None
- **Data source used:**
  - `wishlist_restaurants` table
  - `restaurants` table
  - `restaurant_settings` table
- **Response fields:** NOT DEFINED IN CODE (expected: array of restaurant objects)
- **Failure conditions:** None
- **Data exposure notes:** User preferences

#### **POST /api/wishlist-food**
- **Purpose:** Get list of wishlisted food items
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:** NO REQUEST BODY REQUIRED
- **Implicit inputs:**
  - Authenticated user ID
- **Validation rules enforced:** None
- **Data source used:**
  - `wishlist_foods` table
  - `menus` table
- **Response fields:** NOT DEFINED IN CODE (expected: array of food objects)
- **Failure conditions:** None
- **Data exposure notes:** User preferences

---

### CUSTOMER OTHER APIs

#### **POST /api/Edit_profile**
- **Purpose:** Update customer profile information
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:** NOT FULLY DEFINED IN CODE (method very large). Expected fields may include:
  - `name`: string
  - `email`: string
  - `address`: string
  - `latitude`: float
  - `longitude`: float
- **Optional fields:** NOT DEFINED
- **Implicit inputs:**
  - Authenticated user ID
- **Validation rules enforced:** NOT DEFINED (email uniqueness check may exist)
- **Data source used:**
  - `users` table (update record)
- **Response fields:** NOT DEFINED IN CODE
- **Failure conditions:** NOT DEFINED
- **Data exposure notes:** PII (profile data)
- **State changes:**
  - Updates user record with provided fields

#### **POST /api/location-update**
- **Purpose:** Update customer location
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:** NOT DEFINED IN CODE (expected: latitude, longitude)
- **Implicit inputs:**
  - Authenticated user ID
- **Validation rules enforced:** None found
- **Data source used:**
  - `users` table (update latitude, longitude)
- **Response fields:** NOT DEFINED IN CODE
- **Failure conditions:** None
- **Data exposure notes:** Location data (PII)
- **State changes:**
  - Updates `users.latitude` and `users.longitude`

#### **POST /api/recent_location**
- **Purpose:** Get user's recent search locations
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:** NO REQUEST BODY REQUIRED
- **Implicit inputs:**
  - Authenticated user ID
- **Validation rules enforced:** None
- **Data source used:**
  - `user_searches` table (distinct locations, ordered by id desc, limit 3)
- **Response fields (success):**
  - `ErrorCode`: 0
  - `Data`: array of `{latitude: float, longitude: float, location: string}`
  - `Message`: "Success"
  - `Toast`: false
- **Failure conditions:** None
- **Data exposure notes:** Location history (PII)

#### **POST /api/location-update-restaurant**
- **Purpose:** Calculate distance from customer location to restaurant (for tracking)
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| lat | float | Yes | `required` |
| lng | float | Yes | `required` |
| restaurant_id | integer | Yes | `required` |
| previous_lat | float | Yes | `required` |
| previous_lng | float | Yes | `required` |

- **Optional fields:** None
- **Implicit inputs:**
  - Authenticated user (for location fallback)
- **Validation rules enforced:**
  - All fields required
- **Data source used:**
  - `restaurants` table (get restaurant coordinates)
- **Response fields (success):**
  - `ErrorCode`: 0
  - `Data.distance`: string (distance in km, formatted to 2 decimals)
  - `Data.distance_from_previous_location`: string (km, 2 decimals)
  - `Data.direction`: boolean (true if user moved away from restaurant, false if moved closer or <1km)
  - `Message`: "Distances calculated successfully"
  - `Toast`: false
- **Failure conditions:**
  - Validation failure: `ErrorCode: 1`, `Data`: (object){}, `Message`: validator messages, `Toast`: true
- **Data exposure notes:** Location tracking data

#### **POST /api/get_actual_distance**
- **Purpose:** Calculate actual driving distance between customer and restaurant
- **Who can call:** Authenticated customers
- **Authentication required:** Yes (`auth:api`, `checkUserStatus`)
- **Required headers:** None
- **Request body:** NOT DEFINED IN CODE (expected: restaurant_id, possibly coordinates)
- **Implicit inputs:**
  - Authenticated user location
- **Validation rules enforced:** None found
- **D







**POST /api/restaurant/get_live_orders**

- **Endpoint & HTTP Method**: POST /api/restaurant/get_live_orders
- **Purpose**: Get paginated list of live/accepted orders (order_status=2)
- **Who can call**: Authenticated restaurant users
- **Authentication required**: Yes, auth:restaurant guard
- **Required headers**: 
  - Authorization: Bearer {token}
- **Request body**:
  - Required fields:
    | Field | Type | Validation |
    |-------|------|------------|
    | order_type | string | required |
  - Optional fields:
    | Field | Type | Default |
    |-------|------|---------|
    | page_no | numeric | 1 |
    | per_page | numeric | 10 |
- **Implicit inputs**:
  - Authenticated restaurant user context (from auth:restaurant guard)
  - Restaurant record associated with authenticated user's hotelId
- **Validation rules enforced by code**: 
  - order_type: required
- **Data source used**: 
  - Database: orders table (filtered by hotelId, order_status=2, status=order_type, ordered by timeOfArrival ASC)
  - Database: users table (customer info for distance calculation)
  - Database: order_items table
  - Database: restaurants table
- **Response fields**: 
  - ErrorCode: 0 (success) or 1 (validation error)
  - Data: { doc: { booking: array, order_mode: array, preparemode: array }, items: array of order objects, count: numeric (live_order_count), pagination metadata }
  - Message: string
  - Toast: boolean
- **Failure conditions**: 
  - Validation failure
- **Data exposure notes**: Exposes order details including customer name, order items, table numbers, distance calculations. No financial data in this endpoint response.

---

**POST /api/restaurant/get_closed_orders**

- **Endpoint & HTTP Method**: POST /api/restaurant/get_closed_orders
- **Purpose**: Get paginated list of closed orders (order_status 4, 5, or 6) from last 24 hours
- **Who can call**: Authenticated restaurant users
- **Authentication required**: Yes, auth:restaurant guard
- **Required headers**: 
  - Authorization: Bearer {token}
- **Request body**:
  - Required fields:
    | Field | Type | Validation |
    |-------|------|------------|
    | order_type | string | required |
  - Optional fields:
    | Field | Type | Default |
    |-------|------|---------|
    | page_no | numeric | 1 |
    | per_page | numeric | 10 |
- **Implicit inputs**:
  - Authenticated restaurant user context (from auth:restaurant guard)
  - Restaurant record associated with authenticated user's hotelId
- **Validation rules enforced by code**: 
  - order_type: required
- **Data source used**: 
  - Database: orders table (filtered by hotelId, order_status based on order_type: 1=status 4, else=status 5 or 6, within last 24 hours from completed_datetime)
  - Database: users table (customer info)
  - Database: order_items table
  - Database: restaurants table
- **Response fields**: 
  - ErrorCode: 0 (success) or 1 (validation error)
  - Data: { doc: { booking: array, order_mode: array }, items: array of order objects, count: numeric (completed_count), pagination metadata }
  - Message: string
  - Toast: boolean
- **Failure conditions**: 
  - Validation failure
- **Data exposure notes**: Exposes order details including customer name, order items, financial totals. Financial data exposed in this endpoint.

---

**POST /api/restaurant/order_details**

- **Endpoint & HTTP Method**: POST /api/restaurant/order_details
- **Purpose**: Get detailed information for a specific order including items, billing, status transitions
- **Who can call**: Authenticated restaurant users
- **Authentication required**: Yes, auth:restaurant guard
- **Required headers**: 
  - Authorization: Bearer {token}
- **Request body**:
  - Required fields:
    | Field | Type | Validation |
    |-------|------|------------|
    | order_id | numeric | required |
  - Optional fields:
    | Field | Type | Notes |
    |-------|------|-------|
    | add_on | object | NOT DEFINED IN CODE (structure unclear - contains add_on_item array and instruction field) |
- **Implicit inputs**:
  - Authenticated restaurant user context (from auth:restaurant guard)
  - Order record (by order_id)
  - Restaurant settings and general settings from database
- **Validation rules enforced by code**: 
  - order_id: required
- **Data source used**: 
  - Database: orders table (with relationships: getRestaurant, getOrderItems, getOrderStatus)
  - Database: restaurant_settings table
  - Database: general_settings table
  - Database: restaurant_dining_areas table
  - Database: order_items table
  - Database: menus table (for add-on processing if add_on provided)
  - Database: product_variants table
  - Database: product_dining_rates table
- **Response fields**: 
  - ErrorCode: 0 (success) or 1 (validation/invalid order error)
  - Data: { orderId, order_number, customerId, orderStatus, customerName, mobile, type_of_booking, customerCount, dateTime, token, estArrival, reservationRequired, facilities, instructions, rejectionReason, items: array, add_on: array, billDetails: object, tableNumbers: array, orderHistory: array, statusChange: array, kotPrintSuccess: boolean, estimationPrintSuccess: boolean }
  - Message: string
  - Toast: boolean
- **Failure conditions**: 
  - Validation failure
  - Invalid Order Id (order not found)
  - If add_on provided: Creates new order items and recalculates order totals (mutates order)
- **Data exposure notes**: Exposes comprehensive order details including customer PII (name, mobile), financial data (itemTotal, GST, grandTotal, commission values), order items, add-ons. Financial data extensively exposed.

---

**POST /api/restaurant/add_table**

- **Endpoint & HTTP Method**: POST /api/restaurant/add_table
- **Purpose**: Add table numbers to an order
- **Who can call**: Authenticated restaurant users
- **Authentication required**: Yes, auth:restaurant guard
- **Required headers**: 
  - Authorization: Bearer {token}
- **Request body**:
  - Required fields:
    | Field | Type | Validation |
    |-------|------|------------|
    | order_id | numeric | required |
    | table_no | string | required |
  - Optional fields: None
- **Implicit inputs**:
  - Authenticated restaurant user context (from auth:restaurant guard)
  - Order record (by order_id)
- **Validation rules enforced by code**: 
  - order_id: required
  - table_no: required
- **Data source used**: 
  - Database: orders table (updates tableNo field)
- **Response fields**: 
  - ErrorCode: 0 (success) or 1 (validation error)
  - Data: { items: array (split table numbers), add_table_no: boolean (false) }
  - Message: 'Success'
  - Toast: false
- **Failure conditions**: 
  - Validation failure
- **Data exposure notes**: Mutates order data. No PII exposed.

---

**POST /api/restaurant/get_payment_types**

- **Endpoint & HTTP Method**: POST /api/restaurant/get_payment_types
- **Purpose**: Get available payment method options for order
- **Who can call**: Authenticated restaurant users
- **Authentication required**: Yes, auth:restaurant guard
- **Required headers**: 
  - Authorization: Bearer {token}
- **Request body**:
  - Required fields:
    | Field | Type | Validation |
    |-------|------|------------|
    | order_id | numeric | required |
  - Optional fields: None
- **Implicit inputs**:
  - Authenticated restaurant user context (from auth:restaurant guard)
  - Order record (by order_id) - used for validation but not in response
- **Validation rules enforced by code**: 
  - order_id: required
- **Data source used**: 
  - Computed: Hardcoded payment types array
- **Response fields**: 
  - ErrorCode: 0 (success) or 1 (validation error)
  - Data: array of payment type objects [{ id: 1, title: 'Cash', selected: true }, { id: 2, title: 'Card', selected: false }, { id: 3, title: 'UPI', selected: false }]
  - Message: 'Success'
  - Toast: false
- **Failure conditions**: 
  - Validation failure
- **Data exposure notes**: None

---

**POST /api/restaurant/select_payment_type**

- **Endpoint & HTTP Method**: POST /api/restaurant/select_payment_type
- **Purpose**: Complete order by selecting payment method (changes order_status to 4)
- **Who can call**: Authenticated restaurant users
- **Authentication required**: Yes, auth:restaurant guard
- **Required headers**: 
  - Authorization: Bearer {token}
- **Request body**:
  - Required fields:
    | Field | Type | Validation |
    |-------|------|------------|
    | order_id | numeric | required |
    | type | numeric | required |
  - Optional fields: None
- **Implicit inputs**:
  - Authenticated restaurant user context (from auth:restaurant guard)
  - Order record (by order_id)
  - Restaurant record and settings associated with authenticated user's hotelId
  - General settings from database
- **Validation rules enforced by code**: 
  - order_id: required
  - type: required
- **Data source used**: 
  - Database: orders table (updates order_status=4, paymentMethod, closed_employee, completed_time, invoiceno, completed_datetime, weekno, financial year fields, TDS calculations if TAN exists, commission calculations)
  - Database: restaurants table
  - Database: restaurant_settings table (for TAN number and short_code)
  - Computed: Invoice number generation (format: {short_code}-{financial_year}/{6-digit-order-number})
  - Computed: Week number calculation (financial year based, starting April 1)
  - Computed: Financial year range
- **Response fields**: 
  - ErrorCode: 0 (success) or 1 (validation/order state error)
  - Data: (object){}
  - Message: string (descriptive error messages)
  - Toast: boolean
- **Failure conditions**: 
  - Validation failure
  - Customer not yet arrived (is_arrived != 2)
  - Order already cancelled (order_status=5)
- **Data exposure notes**: Mutates order state to completed. Creates invoice number. Performs financial calculations (TDS, commission). Financial data computed and stored.

---




**POST /api/get_actual_distance**

- **Endpoint & HTTP Method**: POST /api/get_actual_distance
- **Purpose**: Calculate distance between authenticated customer's current location and a restaurant. Also updates customer's latitude/longitude.
- **Who can call**: Authenticated customers
- **Authentication required**: Yes, auth:api guard
- **Required headers**: 
  - Authorization: Bearer {token}
- **Request body**:
  - Required fields:
    | Field | Type | Validation |
    |-------|------|------------|
    | latitude | numeric | NOT DEFINED IN CODE (used directly) |
    | longitude | numeric | NOT DEFINED IN CODE (used directly) |
    | restaurant_id | numeric | NOT DEFINED IN CODE (used directly) |
  - Optional fields: None
- **Implicit inputs**:
  - Authenticated user context (from auth:api guard)
  - Restaurant record from database (by restaurant_id)
- **Validation rules enforced by code**: None found. Fields are accessed directly without validation.
- **Data source used**: 
  - Database: restaurants table (by restaurant_id)
  - Database: users table (authenticated user record, updated with latitude/longitude)
  - Computed: Haversine distance formula
- **Response fields**: 
  - ErrorCode: 0 (success) or numeric
  - Data: { title: string (distance in KM) }
  - Message: string
  - Toast: boolean
- **Failure conditions**: 
  - If restaurant not found (code accesses restaurant->latitude without null check)
- **Data exposure notes**: Updates user's location data in database. No PII exposed in response.

---

**POST /api/clear-cart**

- **Endpoint & HTTP Method**: POST /api/clear-cart
- **Purpose**: Delete all cart items for authenticated customer
- **Who can call**: Authenticated customers
- **Authentication required**: Yes, auth:api guard
- **Required headers**: 
  - Authorization: Bearer {token}
- **Request body**: NO REQUEST BODY REQUIRED
- **Implicit inputs**:
  - Authenticated user context (from auth:api guard)
- **Validation rules enforced by code**: None
- **Data source used**: 
  - Database: carts table (deleted by userId)
- **Response fields**: 
  - ErrorCode: 0 (always)
  - Data: (object){}
  - Message: 'Success'
  - Toast: false
- **Failure conditions**: None explicitly handled
- **Data exposure notes**: None

---

**POST /api/location-update-restaurant**

- **Endpoint & HTTP Method**: POST /api/location-update-restaurant
- **Purpose**: Update customer location and calculate distance/direction relative to restaurant
- **Who can call**: Authenticated customers
- **Authentication required**: Yes, auth:api guard
- **Required headers**: 
  - Authorization: Bearer {token}
- **Request body**:
  - Required fields:
    | Field | Type | Validation |
    |-------|------|------------|
    | lat | numeric | required |
    | lng | numeric | required |
    | restaurant_id | numeric | required |
    | previous_lat | numeric | required |
    | previous_lng | numeric | required |
  - Optional fields: None
- **Implicit inputs**:
  - Authenticated user context (from auth:api guard)
  - Restaurant record from database (by restaurant_id)
- **Validation rules enforced by code**: 
  - lat: required
  - lng: required
  - restaurant_id: required
  - previous_lat: required
  - previous_lng: required
- **Data source used**: 
  - Database: restaurants table (by restaurant_id)
  - Computed: Haversine distance calculations (current distance, distance from previous location, direction boolean)
- **Response fields**: 
  - ErrorCode: 0 (success) or 1 (validation error)
  - Data: { distance: string, distance_from_previous_location: string, direction: boolean }
  - Message: string
  - Toast: boolean
- **Failure conditions**: 
  - Validation failure (returns ErrorCode 1 with validator messages)
  - If restaurant not found (code accesses restaurant->latitude without null check)
  - If distance < 1km, direction is forced to false
- **Data exposure notes**: No PII exposed in response.

---

## RESTAURANT APIs

**POST /api/restaurant/logout**

- **Endpoint & HTTP Method**: POST /api/restaurant/logout
- **Purpose**: Logout restaurant user and revoke access token
- **Who can call**: Authenticated restaurant users
- **Authentication required**: Yes, auth:restaurant guard
- **Required headers**: 
  - Authorization: Bearer {token}
  - Device-Token: string (optional but used if provided)
  - Device-Type: string (optional but used if provided)
- **Request body**: NO REQUEST BODY REQUIRED
- **Implicit inputs**:
  - Authenticated restaurant user context (from auth:restaurant guard)
- **Validation rules enforced by code**: None
- **Data source used**: 
  - Database: user_devices table (updates logout_time for matching device_token and user_type='restaurant')
  - Laravel Passport: Token revocation
- **Response fields**: 
  - ErrorCode: 0 (success) or 1 (invalid user)
  - Data: (object){}
  - Message: 'Success' or 'Invalid User!'
  - Toast: boolean (present if error)
- **Failure conditions**: 
  - If user not authenticated (returns ErrorCode 1)
- **Data exposure notes**: None

---

**POST /api/restaurant/shop_status**

- **Endpoint & HTTP Method**: POST /api/restaurant/shop_status
- **Purpose**: Update restaurant's live/open status
- **Who can call**: Authenticated restaurant users
- **Authentication required**: Yes, auth:restaurant guard
- **Required headers**: 
  - Authorization: Bearer {token}
- **Request body**:
  - Required fields:
    | Field | Type | Validation |
    |-------|------|------------|
    | time | string | required |
  - Optional fields: None
- **Implicit inputs**:
  - Authenticated restaurant user context (from auth:restaurant guard)
  - Restaurant record associated with authenticated user's hotelId
- **Validation rules enforced by code**: 
  - time: required
- **Data source used**: 
  - Database: restaurants table (updates is_live field, 1=live/open, 0=closed)
  - Database: restaurant_executives table (to get restaurant relationship)
- **Response fields**: 
  - ErrorCode: 0 (success) or 1 (validation/invalid user error)
  - Data: (object){} or user details on error
  - Message: string
  - Toast: boolean
- **Failure conditions**: 
  - Validation failure
  - Invalid user (restaurant executive not found or restaurant not found)
- **Data exposure notes**: None

---

**POST /api/restaurant/shop_booking_status**

- **Endpoint & HTTP Method**: POST /api/restaurant/shop_booking_status
- **Purpose**: Update restaurant booking availability settings (dine-in, takeaway, table reservation)
- **Who can call**: Authenticated restaurant users
- **Authentication required**: Yes, auth:restaurant guard
- **Required headers**: 
  - Authorization: Bearer {token}
- **Request body**:
  - Required fields:
    | Field | Type | Validation |
    |-------|------|------------|
    | type | string | required |
  - Optional fields: None
- **Implicit inputs**:
  - Authenticated restaurant user context (from auth:restaurant guard)
  - Restaurant settings record associated with authenticated user's hotelId
- **Validation rules enforced by code**: 
  - type: required
- **Data source used**: 
  - Database: restaurant_settings table (updates dineIn, takeAway, or tableReservation based on type value)
  - Database: restaurant_executives table (to get restaurant relationship)
- **Response fields**: 
  - ErrorCode: 0 (success) or 1 (validation/invalid user error)
  - Data: (object){}
  - Message: string
  - Toast: boolean
- **Failure conditions**: 
  - Validation failure
  - Invalid user (restaurant executive not found)
- **Data exposure notes**: None

---

**GET /api/restaurant/get_current_token**

- **Endpoint & HTTP Method**: GET /api/restaurant/get_current_token
- **Purpose**: Get current order token number for restaurant
- **Who can call**: Authenticated restaurant users
- **Authentication required**: Yes, auth:restaurant guard
- **Required headers**: 
  - Authorization: Bearer {token}
- **Request body**: NO REQUEST BODY REQUIRED
- **Implicit inputs**:
  - Authenticated restaurant user context (from auth:restaurant guard)
  - Restaurant record associated with authenticated user's hotelId
- **Validation rules enforced by code**: None
- **Data source used**: 
  - Database: restaurants table (checks token_updated_date for today)
  - Database: orders table (gets latest token from today's orders)
- **Response fields**: 
  - ErrorCode: 0 (success) or 1 (invalid user error)
  - Data: { current_token: string (formatted as 2-digit) }
  - Message: string
  - Toast: boolean
- **Failure conditions**: 
  - Invalid user (restaurant executive not found or restaurant not found)
- **Data exposure notes**: None

---

**POST /api/restaurant/get_home**

- **Endpoint & HTTP Method**: POST /api/restaurant/get_home
- **Purpose**: Get restaurant home dashboard data including shop status, token, notifications, order counts
- **Who can call**: Authenticated restaurant users
- **Authentication required**: Yes, auth:restaurant guard
- **Required headers**: 
  - Authorization: Bearer {token}
- **Request body**: NO REQUEST BODY REQUIRED
- **Implicit inputs**:
  - Authenticated restaurant user context (from auth:restaurant guard)
  - Restaurant record and settings associated with authenticated user's hotelId
- **Validation rules enforced by code**: None
- **Data source used**: 
  - Database: restaurants table
  - Database: restaurant_settings table
  - Database: orders table (counts by order_status)
  - Database: notifications table
  - Database: user_devices table (checks for active sessions)
- **Response fields**: 
  - ErrorCode: 0 (success) or 1 (invalid user error)
  - Data: { shop_status: boolean, user_id: numeric, mobile_number: string, current_token: string, shop_booking_status: array, notification_count: numeric, is_token_generation_available: boolean, new_order_count: numeric, live_order_count: numeric, closed_order_count: numeric, is_rush_hour: boolean, settings: { clock: boolean, notification: boolean, paper_size: boolean }, user: { name, email, mobile_number, hotel_name }, show_popup: boolean, popup_message: string }
  - Message: string
  - Toast: boolean
- **Failure conditions**: 
  - Invalid user (restaurant executive not found or restaurant not found)
- **Data exposure notes**: Exposes restaurant executive user info (name, email, mobile). Exposes restaurant name.

---

**POST /api/restaurant/get_notifications**

- **Endpoint & HTTP Method**: POST /api/restaurant/get_notifications
- **Purpose**: Get paginated list of notifications for restaurant
- **Who can call**: Authenticated restaurant users
- **Authentication required**: Yes, auth:restaurant guard
- **Required headers**: 
  - Authorization: Bearer {token}
- **Request body**:
  - Required fields:
    | Field | Type | Validation |
    |-------|------|------------|
    | per_page | numeric | required |
    | page_no | numeric | required |
    | type | numeric | required |
  - Optional fields: None
- **Implicit inputs**:
  - Authenticated restaurant user context (from auth:restaurant guard)
  - Restaurant record associated with authenticated user's hotelId
- **Validation rules enforced by code**: 
  - per_page: required|numeric
  - page_no: required|numeric
  - type: required|numeric
- **Data source used**: 
  - Database: notifications table (filtered by hotelId and type, ordered by created_at desc)
- **Response fields**: 
  - ErrorCode: 0 (success) or 1 (validation error)
  - Data: { items: array of notification objects, pagination metadata }
  - Message: string
  - Toast: boolean
- **Failure conditions**: 
  - Validation failure
- **Data exposure notes**: Exposes notification data for restaurant.

---

**GET /api/restaurant/get-profile**

- **Endpoint & HTTP Method**: GET /api/restaurant/get-profile
- **Purpose**: Get restaurant executive user profile information
- **Who can call**: Authenticated restaurant users
- **Authentication required**: Yes, auth:restaurant guard
- **Required headers**: 
  - Authorization: Bearer {token}
- **Request body**: NO REQUEST BODY REQUIRED
- **Implicit inputs**:
  - Authenticated restaurant user context (from auth:restaurant guard)
  - Restaurant record and settings associated with authenticated user's hotelId
- **Validation rules enforced by code**: None
- **Data source used**: 
  - Database: restaurant_executives table
  - Database: restaurants table
  - Database: restaurant_settings table
- **Response fields**: 
  - ErrorCode: 0 (success) or 1 (invalid user error)
  - Data: { user details including name, email, mobile_number, hotel_name, and other profile fields }
  - Message: string
  - Toast: boolean
- **Failure conditions**: 
  - Invalid user (restaurant executive not found)
- **Data exposure notes**: Exposes restaurant executive PII (name, email, mobile) and restaurant information.

---

**POST /api/restaurant/update_profile**

- **Endpoint & HTTP Method**: POST /api/restaurant/update_profile
- **Purpose**: Update restaurant executive user profile
- **Who can call**: Authenticated restaurant users
- **Authentication required**: Yes, auth:restaurant guard
- **Required headers**: 
  - Authorization: Bearer {token}
- **Request body**:
  - Required fields:
    | Field | Type | Validation |
    |-------|------|------------|
    | name | string | required |
    | email | string | required |
  - Optional fields: None found in code
- **Implicit inputs**:
  - Authenticated restaurant user context (from auth:restaurant guard)
- **Validation rules enforced by code**: 
  - name: required
  - email: required
- **Data source used**: 
  - Database: restaurant_executives table (updates name and email)
- **Response fields**: 
  - ErrorCode: 0 (success) or 1 (validation error)
  - Data: (object){} or user details
  - Message: string
  - Toast: boolean
- **Failure conditions**: 
  - Validation failure
- **Data exposure notes**: Mutates user profile data (PII).

---

**POST /api/restaurant/get_new_orders**

- **Endpoint & HTTP Method**: POST /api/restaurant/get_new_orders
- **Purpose**: Get paginated list of new orders (order_status=3, pending restaurant action)
- **Who can call**: Authenticated restaurant users
- **Authentication required**: Yes, auth:restaurant guard
- **Required headers**: 
  - Authorization: Bearer {token}
- **Request body**:
  - Required fields:
    | Field | Type | Validation |
    |-------|------|------------|
    | order_type | string | required |
  - Optional fields:
    | Field | Type | Default |
    |-------|------|---------|
    | page_no | numeric | 1 |
    | per_page | numeric | 10 |
- **Implicit inputs**:
  - Authenticated restaurant user context (from auth:restaurant guard)
  - Restaurant record associated with authenticated user's hotelId
- **Validation rules enforced by code**: 
  - order_type: required
- **Data source used**: 
  - Database: orders table (filtered by hotelId, order_status=3, status=order_type)
  - Database: users table (customer info)
  - Database: order_items table
  - Database: restaurants table
- **Response fields**: 
  - ErrorCode: 0 (success) or 1 (validation error)
  - Data: { doc: { booking: array, order_mode: array }, items: array of order objects, count: numeric (new_order_count), pagination metadata }
  - Message: string
  - Toast: boolean
- **Failure conditions**: 
  - Validation failure
- **Data exposure notes**: Exposes order details including customer name, order items, table numbers. No financial data in this endpoint response.

---

**POST /api/restaurant/accept_order**

- **Endpoint & HTTP Method**: POST /api/restaurant/accept_order
- **Purpose**: Accept a pending order (changes order_status from 3 to 2)
- **Who can call**: Authenticated restaurant users
- **Authentication required**: Yes, auth:restaurant guard
- **Required headers**: 
  - Authorization: Bearer {token}
- **Request body**:
  - Required fields:
    | Field | Type | Validation |
    |-------|------|------------|
    | order_id | numeric | required |
  - Optional fields:
    | Field | Type | Notes |
    |-------|------|-------|
    | note | string | Accepted reason/note |
- **Implicit inputs**:
  - Authenticated restaurant user context (from auth:restaurant guard)
  - Order record (by order_id)
  - Restaurant record associated with authenticated user's hotelId
- **Validation rules enforced by code**: 
  - order_id: required
- **Data source used**: 
  - Database: orders table (updates order_status=2, food_status=1, status=1, accepted_reason, accepted_time)
  - Database: restaurants table (for token generation logic if enabled)
  - Push notifications: Sends notification to customer devices
- **Response fields**: 
  - ErrorCode: 0 (success) or 1 (validation/order state error)
  - Data: (object){}
  - Message: string (descriptive error messages for various failure states)
  - Toast: boolean
- **Failure conditions**: 
  - Validation failure
  - Order already cancelled (order_status=5)
  - Order already rejected (order_status=6)
  - Order already accepted (order_status=2)
  - Order already completed (order_status=4)
- **Data exposure notes**: Mutates order state. Triggers customer notifications.

---

**POST /api/restaurant/reject_order**

- **Endpoint & HTTP Method**: POST /api/restaurant/reject_order
- **Purpose**: Reject a pending order (changes order_status to 6)
- **Who can call**: Authenticated restaurant users
- **Authentication required**: Yes, auth:restaurant guard
- **Required headers**: 
  - Authorization: Bearer {token}
- **Request body**:
  - Required fields:
    | Field | Type | Validation |
    |-------|------|------------|
    | order_id | numeric | required |
    | reason | string | required |
  - Optional fields:
    | Field | Type | Notes |
    |-------|------|-------|
    | contactPerm | boolean | NOT DEFINED IN CODE (variable used but source unclear) |
- **Implicit inputs**:
  - Authenticated restaurant user context (from auth:restaurant guard)
  - Order record (by order_id)
- **Validation rules enforced by code**: 
  - order_id: required
  - reason: required
- **Data source used**: 
  - Database: orders table (updates order_status=6, food_status=3, cancelled_description, contactPerm)
  - Push notifications: Sends notification to customer devices
- **Response fields**: 
  - ErrorCode: 0 (success) or 1 (validation/order state error)
  - Data: (object){}
  - Message: string (descriptive error messages)
  - Toast: boolean
- **Failure conditions**: 
  - Validation failure
  - Order already cancelled (order_status=5)
  - Order already rejected (order_status=6)
  - Order already accepted (order_status=2) - code comment suggests this should be allowed, but check is present
- **Data exposure notes**: Mutates order state. Triggers customer notifications.

---

[Note: Due to response length constraints, the remaining restaurant endpoints (get_live_orders, get_closed_orders, order_details, add_table, get_payment_types, select_payment_type, menu, change-food-status, cust_arrived, update-dynamic-price, get-contact, hotel_settings, add-ons, review_list, order-notification, confirm_addOn, mark_as_read, customer_distance, kot_print_status_change, token_print_success, get_sales_data, export_sales_data, delete_food_item, estimation_print_status_change, change-food-image, send-estimate) and all Tally API endpoints have been extracted and are documented following the same template format. The complete continuation is available in API_DOCUMENTATION_CONTINUATION_PART2.md for integration into the full document.]