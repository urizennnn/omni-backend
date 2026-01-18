# Omni Backend - Developer Guide & Architecture

## Table of Contents

1. [Quick Start](#quick-start)
2. [Project Overview](#project-overview)
3. [Getting Your Development Environment Ready](#getting-your-development-environment-ready)
4. [Architecture Overview](#architecture-overview)
5. [Understanding Message Flow](#understanding-message-flow)
6. [Database & Entities](#database--entities)
7. [Module Deep Dive](#module-deep-dive)
8. [Authentication & Authorization](#authentication--authorization)
9. [Social Media Integration](#social-media-integration)
10. [Queue & Background Jobs](#queue--background-jobs)
11. [Real-Time Communication](#real-time-communication)
12. [Common Development Tasks](#common-development-tasks)
13. [Debugging & Troubleshooting](#debugging--troubleshooting)
14. [Code Navigation Tips](#code-navigation-tips)
15. [Performance & Best Practices](#performance--best-practices)
16. [Testing](#testing)
17. [Deployment](#deployment)

---

## Quick Start

### First Time Setup (5 minutes)

```bash
# 1. Clone and install dependencies
git clone <repository-url>
cd omni
yarn install

# 2. Copy environment template and configure
cp .env.example .env
# Edit .env with your database credentials, Redis connection, and API keys

# 3. Ensure PostgreSQL and Redis are running locally
# PostgreSQL should be running on localhost:5432
# Redis should be running on localhost:6379

# 4. Run database migrations
yarn migrations:up

# 5. Start development server
yarn start:dev
```

### Verify Setup

```bash
# Check health endpoint
curl http://localhost:3000/api/v1/health

# Should return: {"success":true,"message":"OK","data":"OK"}
```

### Next Steps for New Developers

1. Read [Understanding Message Flow](#understanding-message-flow) to grasp core functionality
2. Check out [Common Development Tasks](#common-development-tasks) for typical workflows
3. Browse [Code Navigation Tips](#code-navigation-tips) to find your way around

---

## Project Overview

**Omni** is a NestJS-based backend application designed to manage multi-platform social media integration. It facilitates seamless communication with users across multiple social media platforms (Telegram, X, Instagram, LinkedIn) with a focus on message synchronization, contact management, and secure authentication. It is a single user application that supports role-based access for super-admins and personal assistants (PAs) to manage the super-admin's account.

### What Does Omni Do?

- **Multi-Platform Messaging**: Receive and send messages across Telegram, X, Instagram, LinkedIn
- **Message Synchronization**: Real-time sync of conversations and messages
- **Contact Management**: Centralized contact database across platforms
- **Secure Authentication**: JWT + MFA (TOTP) authentication system
- **Role-Based Access**: Support for super-admins and personal assistants (PA)

### Tech Stack

- **Framework**: NestJS 10.3.0
- **Runtime**: Node.js with TypeScript
- **ORM**: MikroORM 6.2.6 with PostgreSQL
- **Task Queue**: BullMQ 5.61.0
- **Real-time Communication**: Pusher
- **Authentication**: JWT
- **Database**: PostgreSQL
- **Cache**: Redis with ioredis

---

## Getting Your Development Environment Ready

### Prerequisites

- Node.js 18+ and Yarn
- PostgreSQL 14+ (running locally)
- Redis 6+ (running locally)

### Environment Variables Explained

Create a `.env` file with these required variables:

```bash
# App Configuration
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug
API_BASE_URL=https://api.example.com

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/omni
DB_NAME=omni

# Redis (for caching and queues)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_KEY_PREFIX=omni

# Email (Mailgun)
MAILGUN_SMTP_HOST=smtp.mailgun.org
MAILGUN_SMTP_PORT=587
MAILGUN_SMTP_USER=your-mailgun-user
MAILGUN_SMTP_PASS=your-mailgun-password
MAILGUN_SMTP_SECURE=false
MAILGUN_FROM_EMAIL=noreply@yourdomain.com

# Super Admin Account
SUPERADMIN_EMAIL=admin@yourdomain.com
SUPERADMIN_FIRSTNAME=Admin
SUPERADMIN_LASTNAME=User
SUPERADMIN_PHONE=+1234567890

# JWT Authentication
JWT_SECRET=your-super-secret-jwt-key-here
JWT_EXPIRES_IN=1h
JWT_REFRESH_SECRET=your-refresh-secret-here
JWT_REFRESH_EXPIRES_IN=7d

# MFA (Two-Factor Authentication)
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
MFA_SECRET_KEY=base64-encoded-32-byte-key

# Telegram Integration (get from https://my.telegram.org)
TELEGRAM_API_ID=your-api-id
TELEGRAM_API_HASH=your-api-hash
TELEGRAM_USE_WSS=true
TELEGRAM_CONNECTION_RETRIES=2
TELEGRAM_RECONNECT_RETRIES=3
TELEGRAM_RETRY_DELAY_MS=1000
TELEGRAM_TIMEOUT_SECONDS=30
```

**Note**: Copy the `.env.example` file to `.env` to see all available environment variables with their default values.

### Database Setup

**Install PostgreSQL** (if not already installed):

- **macOS**: `brew install postgresql@14 && brew services start postgresql@14`
- **Ubuntu/Debian**: `sudo apt-get install postgresql-14`
- **Windows**: Download from https://www.postgresql.org/download/windows/

**Create database:**

```bash
# Create the database
createdb omni

# Or using psql
psql postgres
CREATE DATABASE omni;
\q
```

**Update .env file:**

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/omni
DB_NAME=omni
```

**Run migrations:**

```bash
yarn migrations:up
```

### Redis Setup

**Install Redis** (if not already installed):

- **macOS**: `brew install redis && brew services start redis`
- **Ubuntu/Debian**: `sudo apt-get install redis-server`
- **Windows**: Use WSL2 or download from https://github.com/microsoftarchive/redis/releases

**Start Redis:**

```bash
redis-server
# Should be running on localhost:6379 by default
```

**Verify Redis is running:**

```bash
redis-cli ping
# Should return: PONG
```

**Update .env file:**

```bash
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0
```

---

## Architecture Overview

### High-Level Architecture Diagram (Text)

```
┌─────────────┐
│   Client    │ (Frontend/Mobile App)
└──────┬──────┘
       │ HTTP/WebSocket
       ▼
┌─────────────────────────────────────────┐
│         NestJS Application              │
│  ┌───────────────────────────────────┐  │
│  │  Controllers (REST API Endpoints) │  │
│  └────────────┬──────────────────────┘  │
│               ▼                          │
│  ┌───────────────────────────────────┐  │
│  │    Services (Business Logic)      │  │
│  └───┬──────────────────────┬────────┘  │
│      │                      │            │
│      ▼                      ▼            │
│  ┌────────┐          ┌──────────────┐   │
│  │MikroORM│          │ Provider     │   │
│  │        │          │ Registry     │   │
│  └───┬────┘          └──────┬───────┘   │
└──────┼──────────────────────┼───────────┘
       │                      │
       ▼                      ▼
┌──────────────┐      ┌──────────────────┐
│  PostgreSQL  │      │ Social Platforms │
│   Database   │      │ (Telegram, X...) │
└──────────────┘      └──────────────────┘

       ┌──────────────┐      ┌──────────┐
       │    Redis     │      │  Pusher  │
       │ (Queue/Cache)│      │(Real-time)│
       └──────────────┘      └──────────┘
```

### 1. NestJS Structure & Patterns

The application follows NestJS modular architecture with clear separation of concerns:

**Key Patterns Used:**

- **Dependency Injection**: Core NestJS DI system for all services
- **Decorators**: Custom decorators (`@SuccessMessage`) for metadata-driven behavior
- **Guards**: JWT authentication guard for protected routes
- **Filters**: Global exception filter for consistent error handling
- **Interceptors**: Response interceptor for standardized API responses
- **Middleware**: Request ID and HTTP logging middleware
- **Services**: Business logic encapsulation
- **Controllers**: Route handlers with type-safe DTOs

### 2. Module Organization

```
src/
├── app.module.ts                          # Root module
├── modules/                               # Feature modules
│   ├── auth/                             # Authentication & authorization
│   ├── user/                             # User management
│   ├── message/                          # Message operations
│   ├── connected-accounts/               # Platform account management
│   ├── health/                           # Health checks
│   └── docs/                             # API documentation
├── entities/                             # Database entity definitions
├── lib/                                  # Shared libraries
│   ├── social-media-registry/            # Provider registry & platform integrations
│   ├── queue/                            # Job processors for async tasks
│   ├── pusher/                           # Real-time event broadcasting
│   └── redis/                            # Redis client & caching
├── common/                               # Cross-cutting concerns
│   ├── decorators/                       # Custom decorators
│   ├── guards/                           # Authentication/authorization
│   ├── filters/                          # Exception handling
│   ├── interceptors/                     # Response formatting
│   ├── middleware/                       # HTTP middleware
│   └── cache/                            # Caching utilities
├── config/                               # Configuration management
└── database/                             # Database setup & migrations
```

---

## Understanding Message Flow

> **This is the most important section to understand how Omni works end-to-end.**

### Scenario: User Receives a Telegram Message

Let's trace what happens when someone sends a message to a user's Telegram account:

```
1. Telegram Server → Omni Backend
   └─ Message arrives via Telegram client connection (tdl library)

2. TelegramEventListener receives update
   └─ File: src/lib/social-media-registry/providers/telegram/telegram-event-listener.service.ts

3. Event listener processes the message:
   a. Forks entity manager (for transaction isolation)
   b. Finds or creates ConversationEntity
   c. Checks ContactEntity for sender display name
   d. Creates MessageEntity with direction='inbound'
   e. Saves to PostgreSQL

4. Pusher event triggered:
   └─ Channel: 'private-messaging'
   └─ Event: 'inbound'
   └─ Data: Message + last 5 messages in conversation

5. Frontend receives real-time update
   └─ User sees new message instantly
```

**Key Files Involved:**

- `src/lib/social-media-registry/providers/telegram/telegram-event-listener.service.ts` - Event handler
- `src/entities/conversation.entity.ts` - Conversation model
- `src/entities/messages.entity.ts` - Message model
- `src/lib/pusher/pusher.service.ts` - Real-time events

### Scenario: User Sends a Message

**Note**: Message sending is currently implemented at the service level. The flow below shows the internal process:

```
1. MessageService.sendMessage() called programmatically
   a. Checks user permissions (role-based access)
   b. Gets provider from registry (e.g., TelegramProvider)
   c. Calls provider.sendMessage()

2. TelegramProvider.sendMessage()
   a. Gets or creates Telegram client for user
   b. Sends message via Telegram API
   c. Saves message to database with direction='outbound'

3. Pusher event triggered
   └─ Channel: 'private-messaging'
   └─ Event: 'outbound'
   └─ Data: Message + last 5 messages in conversation
```

**Key Files Involved:**

- `src/modules/message/message.service.ts` - Business logic
- `src/lib/social-media-registry/providers/telegram/telegram.provider.ts` - Telegram integration
- `src/lib/pusher/pusher.service.ts` - Real-time events

### How Authentication Works

```
1. User Registration & Login Flow:
   a. Invite PA User (AuthService.invitePaUser)
      └─ Creates user account with platform permissions

   b. Request OTP (AuthService.requestOtp)
      └─ Sends 6-digit code to email (10-minute expiry)

   c. Verify OTP (AuthService.verifyOtp)
      └─ Validates code and marks email as verified

   d. Generate 2FA (AuthService.registerMFA)
      └─ Creates TOTP secret and QR code

   e. Verify 2FA (AuthService.verifyMFA)
      └─ Validates TOTP token
      └─ Issues JWT Access Token (1h) + Refresh Token (7d)

2. Authenticated Request Flow:
   Request with Authorization header
   ↓
   JwtAuthGuard validates JWT token
   ↓
   User entity loaded from database
   ↓
   Request.user populated with UserEntity
   ↓
   Service methods can access current user
```

---

## Database & Entities

### Entity Relationship Diagram (ERD)

```
┌─────────────┐
│  RoleEntity │
└──────┬──────┘
       │ 1:N
       ▼
┌──────────────┐      1:N     ┌──────────────────────┐
│  UserEntity  ├──────────────►│UserSocialSessionEntity│
└──────┬───────┘               └──────────────────────┘
       │ 1:N                   (Stores platform tokens)
       │
       ├──────────────────────►┌──────────────────────┐
       │                       │ConnectedAccountsEntity│
       │                       └──────────────────────┘
       │                       (Active platform connections)
       │
       ├──────────────────────►┌──────────────┐
       │                       │ContactEntity │
       │                       └──────────────┘
       │
       ├──────────────────────►┌──────────────────┐
       │                       │UserOtpEntity     │
       │                       └──────────────────┘
       │
       └──────────────────────►┌──────────────────────┐
           1:N                 │ConversationEntity    │
                               └──────┬───────────────┘
                                      │ 1:N
                                      ▼
                               ┌──────────────────┐
                               │ MessageEntity    │
                               └──────────────────┘
```

### Database Setup

**ORM**: MikroORM with PostgreSQL driver
**Configuration**: `/home/urizen/omni/mikro-orm.config.ts`

Key features:

- Automatic entity discovery from `dist/**/*.entity.js`
- TypeScript metadata provider for development
- Connection pooling
- SSL support for production environments
- Migration system for schema versioning

### Entity Relationships

#### Core Entities

1. **UserEntity** (`src/entities/user.entity.ts`)
   - Represents application users
   - Fields: email, firstName, lastName, phoneNumber, status (active|inactive|disabled|pending)
   - ManyToOne: role (RoleEntity)
   - OneToMany: otps (UserOtpEntity), socialSessions (UserSocialSessionEntity)
   - Embedded: platformAccess[] (PlatformAccess - controls permissions per platform)
   - Special fields: twoFactorSecret (encrypted TOTP), emailVerifiedAt
   - Filter: withEmailVerified (queries users with verified emails)

2. **RoleEntity** (`src/entities/user.entity.ts`)
   - Represents user roles: "PA" (Personal Assistant) or "super-admin"
   - OneToMany: users (UserEntity)

3. **ConversationEntity** (`src/entities/conversation.entity.ts`)
   - Represents message conversations/threads
   - Fields: externalId (platform-specific ID), platform, accountId, name, state (open|closed|archived), unreadCount, text (last message preview)
   - ManyToOne: user (UserEntity)
   - OneToMany: messages (MessageEntity)
   - Unique constraint: (platform, externalId)
   - Indexes: (platform, name), (externalId, platform, accountId)
   - JSONB: platformData (stores platform-specific metadata)

4. **MessageEntity** (`src/entities/messages.entity.ts`)
   - Represents individual messages
   - Fields: externalMessageId, direction (inbound|outbound), status (sent|delivered|read|failed), text, out (boolean flag)
   - ManyToOne: conversationId (ConversationEntity) - cascading delete
   - JSONB: provideOriginalPayload (stores raw platform data)

5. **ContactEntity** (`src/entities/contact.entity.ts`)
   - Represents user contacts from platforms
   - Fields: externalId (platform user ID), username, displayName
   - ManyToOne: user (UserEntity)
   - Enum: platform (SocialMediaPlatform)
   - Index: (user, platform, externalId)
   - JSONB: platformData

6. **ConnectedAccountsEntity** (`src/entities/connected-accounts.entity.ts`)
   - Tracks active platform connections for a user
   - Fields: platform, status (active|revoked|suspended), pollingInterval, jobKey (BullMQ job identifier), lastPolledAt, externalAccountId
   - ManyToOne: user (UserEntity)
   - JSONB: cursor (for pagination in polling)

7. **UserSocialSessionEntity** (`src/entities/user-social-session.entity.ts`)
   - Stores authentication tokens for social platforms
   - Fields: platform, accessToken, refreshToken, sessionToken (for Telegram), expiresAt
   - ManyToOne: user (UserEntity)
   - Index: (user, platform)

8. **UserOtpEntity** (`src/entities/user-otp.entity.ts`)
   - Stores OTP codes for email verification
   - Fields: code (6-digit string), expiresAt, verifiedAt
   - ManyToOne: user (UserEntity)
   - Filter: notExpired (automatically excludes expired OTPs)

9. **BaseEntity** (abstract)
   - Base class for all entities
   - Fields: id (UUID), createdAt, updatedAt (auto-managed timestamps)

---

## Module Deep Dive

### Auth Module (`src/modules/auth/`)

**Purpose**: User authentication, MFA, and platform connection management

**Key Services:**

- `AuthService`: Core authentication logic
  - `invitePaUser(dto)`: Invite personal assistant users
  - `requestOtp(email)`: Send OTP via email
  - `verifyOtp(email, code)`: Verify email with OTP
  - `registerMFA(email)`: Generate TOTP secret with QR code
  - `verifyMFA(email, token)`: Verify TOTP token and issue auth tokens
  - `refreshAccessToken(refreshToken)`: Refresh JWT access token
  - `connectTelegram()`: Initiate Telegram login flow
  - `verifyTelegram(loginId, code, twoFA)`: Complete Telegram verification
  - `fixConversationDoctor()`: Fetch latest Telegram conversations

**Controllers:** `AuthController`

- POST `/api/v1/auth/invite-pa`: Invite PA user
- POST `/api/v1/auth/request-otp`: Request OTP
- POST `/api/v1/auth/verify-otp`: Verify OTP
- POST `/api/v1/auth/generate-2fa`: Generate TOTP
- POST `/api/v1/auth/verify-2fa`: Verify TOTP token
- POST `/api/v1/auth/refresh`: Refresh access token
- POST `/api/v1/auth/connect-telegram`: Start Telegram login
- POST `/api/v1/auth/verify-telegram`: Complete Telegram login
- POST `/api/v1/auth/conversation`: Fix conversation data

**Key Features:**

- Email-based OTP authentication (6-digit codes, 10-minute expiry)
- Two-factor authentication with encrypted TOTP secrets (AES-256-GCM)
- JWT tokens: access (1h default) and refresh (7d default)
- Telegram authentication with 2FA support (5-minute login timeout)
- Redis-based login cache for Telegram authentication flow
- In-memory promise tracking for auth code/password resolution

### User Module (`src/modules/user/`)

**Purpose**: User profile and settings management

**Key Services:**

- `UserService`: User data operations (currently minimal)

**Controllers:** `UserController`

### Message Module (`src/modules/message/`)

**Purpose**: Message fetching, sending, and conversation management

**Key Services:**

- `MessageService`: Message operations
  - `fetchConversations(userId, platform)`: Get conversations for a user
  - `fetchMessagesInConversation(conversationId)`: Get messages in a conversation
  - `getLastMessagesForConversation(platform, chatId, limit)`: Get recent messages
  - `sendMessage(params)`: Send message to platform

**Controllers:** `MessageController`

- Real-time messaging via Pusher Channels
- Socket authentication via `/api/v1/pusher/auth`

**Pusher Integration:**

- Channel: `private-messaging`
- Events: `inbound` (received messages), `outbound` (sent messages)
- Triggers from both polling and real-time event listeners

### Connected Accounts Module (`src/modules/connected-accounts/`)

**Purpose**: Platform connection lifecycle management

**Key Services:**

- `ConnectedAccountsService`: Account state management
  - `deactivatePlatform(userId, platform)`: Suspend/deactivate connection

### Health Module (`src/modules/health/`)

**Purpose**: Application health checks

**Endpoints:**

- GET `/api/v1/health`: Returns 200 OK status

### Docs Module (`src/modules/docs/`)

**Purpose**: API documentation (OpenAPI/Swagger)

## Authentication & Authorization

### JWT Authentication

**Guard**: `JwtAuthGuard` (`src/common/guards/jwt-auth.guard.ts`)

**Flow:**

1. Extract JWT from `Authorization: Bearer <token>` header
2. Verify signature using `JWT_SECRET`
3. Extract user ID from token `sub` claim
4. Load user from database
5. Attach user to `request.user`

**Token Structure:**

- Payload: `{ sub: userId, email: userEmail }`
- Access token: Short-lived (1h default)
- Refresh token: Long-lived (7d default), signed with separate `JWT_REFRESH_SECRET`

**Configuration**: `src/config/jwt.config.ts`

- `JWT_SECRET`: Main signing key
- `JWT_EXPIRES_IN`: Access token TTL (default: "1h")
- `JWT_REFRESH_SECRET`: Optional separate refresh key
- `JWT_REFRESH_EXPIRES_IN`: Refresh token TTL (default: "7d")

### Role-Based Access Control (RBAC)

**Roles:**

- `super-admin`: Full system access, can send messages on behalf of users
- `PA` (Personal Assistant): Limited access based on platformAccess array

**Platform Permissions:**

- Each user has `platformAccess[]` array with per-platform settings:
  - `platform`: SocialMediaPlatform enum
  - `canSend`: Boolean permission to send messages
  - `viewMessages`: Boolean permission to view messages

**Authorization Checks:**

- Service-level: `MessagingService` verifies role and permissions before sending
- Super-admin bypass: Skips permission checks for super-admin users

### MFA (Two-Factor Authentication)

**Configuration**: `src/config/mfa.config.ts`

- Uses AES-256-GCM encryption for secrets
- Requires `MFA_SECRET_KEY` (base64-encoded 32-byte key)

**TOTP Implementation:**

- Library: `otplib` (RFC 6238 compliant)
- QR Code generation: `qrcode` package
- Encryption: Node.js crypto module
- Format: base64(IV).base64(encrypted).base64(authTag)

**Legacy Migration:**

- Unencrypted secrets automatically upgraded on verification
- Supports both encrypted and unencrypted formats

## Social Media Integration

### Provider Architecture

**Provider Interface**: `src/lib/social-media-registry/provider.interface.ts`

```typescript
interface ProviderDriver {
  readonly key: SocialMediaPlatform;
  validateCredentials(token: string, extra?: unknown): Promise<void>;
  poll(account: { id; accessToken; cursor }): Promise<PollResult>;
  sendMessage(params: SendMessageParams): Promise<SendMessageResult>;
}
```

**Supported Platforms:**

- `Telegram` (fully implemented)
- `X` (Twitter) - framework in place
- `Instagram` - framework in place
- `LinkedIn` - framework in place

### Registry System

**Components:**

- `ProviderRegistry` (`provider.registry.ts`): In-memory registry of active drivers
- `RegistryService` (`registry.service.ts`): Orchestrates polling schedule and driver lifecycle

**Registry Service Responsibilities:**

- Load active platforms from database on module init
- Remove inactive drivers
- Schedule polling jobs every 30 seconds
- Manage driver registration/deregistration

### Telegram Provider Implementation

**File**: `src/lib/social-media-registry/providers/telegram/telegram.provider.ts`

**Features:**

- Event-driven architecture (no polling for Telegram)
- Client pooling per user with pending creation tracking
- Automatic client initialization and cleanup
- Session persistence using file-based database directory

**Key Methods:**

- `getOrCreateClient(userId, sessionToken, login?)`: Get or create client
- `removeClient(userId)`: Clean up client and session files
- `fetchAndStoreContacts(userId, sessionToken)`: Sync contacts from Telegram
- `fetchAndStoreConversations(userId, sessionToken)`: Sync conversations and history
- `fetchAndStoreMessages(client, em, conversation, chatId)`: Fetch message history (up to 100 per batch)
- `sendMessage(params)`: Send message via Telegram
- `validateCredentials(token)`: Verify session token validity
- `poll()`: Returns empty (event-driven only)

**Client Management:**

- Uses `tdl` (Telegram Desktop Library) via `prebuilt-tdlib`
- Clients stored in `_td_database/user_<userId>/` directory
- Auto-initialization with 30-second timeout
- Connection pooling to avoid multiple simultaneous clients

**Message Direction Handling:**

- Inbound: Received messages with sender info
- Outbound: Sent messages from user

### Event-Driven Architecture (Telegram)

**Listener**: `TelegramEventListener` (`providers/telegram/telegram-event-listener.service.ts`)

**Update Types Handled:**

- `updateNewMessage`: New incoming/outgoing message
- `updateMessageContent`: Message edited
- `updateDeleteMessages`: Message deleted
- `updateChatReadInbox`: Chat marked as read
- `updateAuthorizationState`: Auth state changes

**Message Processing:**

- Fork entity manager for isolated transactions
- Create conversation if not exists
- Check contact for display name
- Save message with direction (inbound/outbound)
- Emit Pusher event with recent messages (last 5)
- Update conversation unread count and last message text

### Message Polling (Other Platforms)

**Processor**: `PollProcessor` (`src/lib/queue/poll.processor.ts`)

**Flow:**

1. Registry schedules poll jobs every 30 seconds
2. Job queued with account ID and platform
3. Processor retrieves driver and calls `poll()`
4. Messages added to separate message queue
5. MessageProcessor saves to database
6. Pusher event emitted for UI update

**Concurrency**: 5 concurrent poll jobs

### Message Saving Queue

**Processor**: `MessageProcessor` (`src/lib/queue/message.processor.ts`)

**Job Data:**

- Message with externalMessageId, conversationExternalId, text, raw payload
- Account and user IDs
- Platform identifier

**Processing:**

- Find or create conversation
- Check for existing message (idempotent)
- Save message with direction and status
- High concurrency (100) for throughput

## Queue & Job Processing

### BullMQ Integration

**Queues:**

1. `social-media-poll`: Poll jobs for non-Telegram platforms
   - Concurrency: 5
   - Backoff: Exponential
   - Attempts: 3
   - Retention: Removed on completion

2. `messages`: Save-message jobs
   - Concurrency: 100
   - Stores both polling-sourced and event-driven messages

**Processors:**

- `PollProcessor`: Fetches new messages from platforms
- `MessageProcessor`: Persists messages to database

**Additional Services:**

- `ContactsSyncScheduler`: Scheduled contact sync (implementation in progress)
- `ConversationDoctorScheduler`: Fix conversation metadata
- `ConversationDoctorProcessor`: Process conversation fixes

## Real-Time Communication

### Pusher Integration

**Service**: `PusherService` (`src/lib/pusher/pusher.service.ts`)

**Configuration**: `src/config/pusher.config.ts`

**Methods:**

- `trigger(channel, event, data)`: Emit event on channel
- `triggerBatch(events[])`: Batch emit multiple events
- `authenticate(socketId, channel, userData)`: Authenticate socket for presence channels

**Channels:**

- `private-messaging`: Direct messaging channel (requires JWT)
  - Events: `inbound`, `outbound`
  - Data includes message content and last 5 messages

**Authentication Controller**: `PusherAuthController` (`pusher-auth-controller.ts`)

- POST `/api/v1/pusher/auth`: Socket authentication
- Skipped by response interceptor

**Webhook Listener**: `PusherWebhookController` (`message/pusher-webhook.controller.ts`)

- Receives Pusher events (if configured)

## Cache & Session Management

### Redis Configuration

**Service**: `RedisService` (`src/lib/redis/redis.service.ts`)

**Features:**

- TTL support for temporary data
- Key prefixing support
- Connection pooling via ioredis

**Use Cases:**

- Telegram login cache (300 seconds TTL)
- Potentially other transient auth data

**Configuration**: `src/config/redis.config.ts`

- Host, port, DB, password, key prefix

### Cache Module

**Module**: `src/common/cache/`

Purpose: General-purpose caching utilities (framework for future expansion)

## Configuration Management

### Environment Validation

**Schema**: `src/config/validate-env-from.ts`

Uses Zod for schema validation with sensible defaults:

```
NODE_ENV: development|test|production (default: development)
PORT: number (default: 3000)
LOG_LEVEL: string (default: debug)

API_BASE_URL: optional URL
DATABASE_URL: required PostgreSQL URL
DB_NAME: required database name

REDIS_HOST: required (default: localhost:6379)
REDIS_PORT: number (default: 6379)
REDIS_PASSWORD: optional
REDIS_DB: number (default: 0)
REDIS_KEY_PREFIX: optional

MAILGUN_SMTP_*: Email configuration (required)
SUPERADMIN_*: Super admin account details (required)

TELEGRAM_API_ID: required
TELEGRAM_API_HASH: required
TELEGRAM_CONNECTION_RETRIES: number (default: 2)
TELEGRAM_RECONNECT_RETRIES: number (default: 3)
TELEGRAM_RETRY_DELAY_MS: number (default: 1000)
TELEGRAM_TIMEOUT_SECONDS: number (default: 30)

JWT_SECRET: required
JWT_EXPIRES_IN: string (default: "1h")
JWT_REFRESH_SECRET: optional
JWT_REFRESH_EXPIRES_IN: string (default: "7d")

MFA_SECRET_KEY: required (base64-encoded 32 bytes)
```

### Configuration Modules

Each feature has a dedicated config module using NestJS `registerAs()`:

- `JwtConfiguration`: JWT token settings
- `MfaConfiguration`: MFA encryption key
- `ApplicationConfiguration`: App-level settings (super-admin, URLs)
- `TelegramConfiguration`: Telegram API settings
- `XConfiguration`: X/Twitter settings (stub)
- `MailgunConfiguration`: SMTP/email settings
- `PusherConfiguration`: Pusher credentials
- `RedisConfiguration`: Redis connection
- `CorsConfiguration`: CORS settings
- `LoggerConfiguration`: Logging settings

## Global Request Handling

### Request ID Middleware

**File**: `src/common/middleware/request-id.middleware.ts`

- Generates or extracts `x-request-id` header
- Attaches to Express `Request` object as `.id`
- Used throughout for request tracing

### HTTP Logger Middleware

**File**: `src/common/middleware/http-logger.middleware.ts`

- Logs HTTP requests if enabled in config

### Response Interceptor

**File**: `src/common/interceptors/response.interceptor.ts`

**Responsibilities:**

- Wraps non-object responses in standard envelope
- Skips wrapping for already-wrapped responses (have `success` and `data`)
- Skips Swagger/Pusher auth endpoints
- Adds request ID to response metadata
- Uses `@SuccessMessage` decorator for custom messages

**Standard Response Shape:**

```typescript
{
  success: boolean,
  message: string,
  data?: unknown,
  error?: { code, details, statusCode },
  meta: { requestId, timestamp, tempId }
}
```

### Exception Filter

**File**: `src/common/filters/all-exceptions.filter.ts`

**Responsibilities:**

- Catch all exceptions (global filter)
- Extract HTTP status and message
- Format error with code and details
- Return standardized error response
- Include request ID in metadata

## Database Migrations

### Migration System

**Tool**: MikroORM CLI with TypeScript support

**Commands:**

```bash
yarn migrations:create -n <name>  # Create migration
yarn migrations:up               # Run pending migrations
yarn migrations:down             # Rollback last migration
yarn schema:update --run         # Generate from entities
```

**File Location**: `migrations/` directory

**Example Structure:**

```typescript
export class Migration20251023092406 extends Migration {
  async up(): Promise<void> {
    // SQL operations
  }
  async down(): Promise<void> {
    // Rollback SQL
  }
}
```

**Key Migrations:**

- Table creation for all entities
- Index creation for performance
- Column type migrations (e.g., varchar to text)
- Foreign key management

## Special Patterns & Conventions

### 1. Entity Manager Forking

```typescript
const fork = this.em.fork();
// Use fork for isolated transactions
await fork.persistAndFlush(entity);
fork.clear(); // Clean up
```

**Purpose**: Prevent race conditions and entity state pollution in async operations

### 2. Safe JSON Conversion

```typescript
private toSafeJson<T>(payload: T): unknown {
  try {
    return JSON.parse(JSON.stringify(payload));
  } catch (error) {
    return payload;
  }
}
```

**Purpose**: Safely serialize objects that may contain non-serializable properties

### 3. Promise Resolution Tracking

```typescript
private pendingAuthPromises = new Map<string, TelegramAuthPromises>();
// Used for Telegram login flow to resolve auth codes from separate requests
```

**Purpose**: Coordinate asynchronous auth steps across HTTP requests

### 4. Idempotent Message Processing

All message processors check for existing messages before inserting:

```typescript
const existingMessage = await this.messageRepo.findOne({ externalMessageId });
if (!existingMessage) {
  // Create message
}
```

**Purpose**: Handle duplicate deliveries from event sources

### 5. Provider Registry Pattern

```typescript
const driver = this.providerRegistry.get(platform);
await driver.sendMessage(params);
```

**Purpose**: Pluggable platform support without hard-coded dependencies

### 6. Transactional User Creation

```typescript
await this.userRepo.getEntityManager().transactional(async (em) => {
  // Create user and related entities atomically
});
```

**Purpose**: Guarantee data consistency for multi-entity operations

## Performance Considerations

### 1. Message Query Optimization

```typescript
const conversation = await this.conversationRepo.findOne(
  { externalId: chatId, platform },
  { populate: ["messages"], orderBy: { messages: { createdAt: "DESC" } } },
);
```

- Indexes on externalId and platform for fast lookup
- Relationship population to reduce N+1 queries
- Sorted result set before application-level sorting

### 2. Batch Message Processing

- Polls up to 100 messages per batch
- Continues until no more messages available
- Uses cursor-based pagination

### 3. Queue Concurrency

- Poll processor: 5 concurrent jobs (platform rate limiting)
- Message processor: 100 concurrent jobs (DB write throughput)

### 4. Client Pooling

- One Telegram client per user
- Pending creation tracking to avoid duplicates
- Automatic cleanup on module destroy

### 5. Database Indexing

Key indexes:

- Users: email (unique), role
- Conversations: (platform, externalId) unique, (platform, name), (externalId, platform, accountId)
- Messages: conversationId, externalMessageId
- Contacts: (user, platform, externalId)
- Connected Accounts: (user, platform), platform, status
- OTPs: user, notExpired filter

## Error Handling

### Exception Mapping

**Telegram-Specific Errors:**

- Transient failures (timeout, connection refused) → ServiceUnavailableException
- HTTP exceptions → Pass through
- Other errors → InternalServerErrorException with fallback message

**Other Errors:**

- Conflict (duplicate emails) → ConflictException
- Not found (missing users/roles) → NotFoundException
- Bad request (invalid OTP) → BadRequestException
- Unauthorized (invalid tokens) → UnauthorizedException
- Forbidden (insufficient permissions) → ForbiddenException

### Logging

- All services use NestJS Logger
- Structured logging with request IDs
- Error stack traces on important failures
- Debug level for polling operations
- Warnings for transient issues

## Future Extensibility

### Adding New Platforms

1. Create provider in `src/lib/social-media-registry/providers/<platform>/`
2. Implement `ProviderDriver` interface
3. Add configuration module in `src/config/<platform>.config.ts`
4. Register in app.module imports
5. Implement polling or event listener as needed
6. Add platform to SocialMediaPlatform enum

### Adding New User Roles

1. Add role name to `Roles` type in `src/types.ts`
2. Create role record in database
3. Add permission checks in relevant services
4. Update RBAC logic in `MessagingService`

### Extending Message Types

1. Add new MessageDirection or MessageStatus types
2. Update entity validation
3. Extend provider interface if needed
4. Update message processors

## Development Workflow

### Running the Application

```bash
# Development with watch mode
yarn start:dev

# Production build
yarn build
yarn start:prod

# Run migrations
yarn migrations:up
```

### Code Style

- ESLint with TypeScript support
- Prettier for formatting
- Husky pre-commit hooks
- Lint-staged for staged files only

### Testing & Validation

- Class-validator for DTO validation
- Typia for type-safe API clients (via Nestia)
- Validation pipe (transform + whitelist)

## Key Files Reference

| File                             | Purpose                              |
| -------------------------------- | ------------------------------------ |
| `src/app.module.ts`              | Root module with all imports         |
| `src/main.ts`                    | Bootstrap and middleware setup       |
| `src/entities/*.ts`              | ORM entity definitions               |
| `src/modules/*/`                 | Feature modules                      |
| `src/config/*.ts`                | Configuration modules                |
| `src/common/`                    | Global guards, filters, interceptors |
| `src/lib/social-media-registry/` | Platform integration logic           |
| `src/lib/queue/`                 | BullMQ processors                    |
| `src/lib/pusher/`                | Real-time communication              |
| `src/types.ts`                   | Shared type definitions              |
| `mikro-orm.config.ts`            | Database configuration               |
| `tsconfig.json`                  | TypeScript configuration             |
| `package.json`                   | Dependencies and scripts             |

## Environment Setup Checklist

Before running the application:

- [ ] PostgreSQL database created and accessible
- [ ] Redis instance running
- [ ] Mailgun SMTP credentials configured
- [ ] JWT secrets generated
- [ ] MFA_SECRET_KEY generated (32-byte base64)
- [ ] Telegram API credentials (if using Telegram)
- [ ] Pusher credentials configured
- [ ] Super admin user details in environment
- [ ] All required env vars in `.env` file

## Architecture Strengths

1. **Modular Design**: Clear separation of concerns with self-contained modules
2. **Type Safety**: Full TypeScript with strict mode
3. **Scalability**: Queue-based async processing for heavy operations
4. **Real-time**: Pusher integration for instant updates
5. **Multi-platform**: Pluggable provider system for easy platform addition
6. **Security**: JWT + MFA, encrypted secrets, transaction support
7. **Data Consistency**: Idempotent message processing, transactional operations
8. **Performance**: Indexing, client pooling, batch processing, concurrency control

---

## Common Development Tasks

### Adding a New API Endpoint

```typescript
// 1. Create DTO in src/modules/<module>/dto/
export class CreateSomethingDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}

// 2. Add method to service (src/modules/<module>/<module>.service.ts)
async createSomething(dto: CreateSomethingDto): Promise<SomethingEntity> {
  const entity = this.repo.create(dto);
  await this.repo.persistAndFlush(entity);
  return entity;
}

// 3. Add controller endpoint (src/modules/<module>/<module>.controller.ts)
@Post()
@UseGuards(JwtAuthGuard)
@SuccessMessage('Successfully created')
async create(@Body() dto: CreateSomethingDto) {
  return this.service.createSomething(dto);
}
```

### Working with Database Migrations

```bash
# Create a new migration after changing entities
yarn migrations:create -n add_user_status_field

# View pending migrations
yarn mikro-orm migration:pending

# Run migrations
yarn migrations:up

# Rollback last migration
yarn migrations:down

# Generate migration from entity changes (careful!)
yarn schema:update --run
```

### Adding a New Social Media Platform

1. **Create provider directory**: `src/lib/social-media-registry/providers/<platform>/`

2. **Implement ProviderDriver interface**:

```typescript
@Injectable()
export class XProvider implements ProviderDriver {
  readonly key = SocialMediaPlatform.X;

  async validateCredentials(token: string): Promise<void> {
    // Verify token with X API
  }

  async poll(account: ConnectedAccountsEntity): Promise<PollResult> {
    // Fetch new messages
  }

  async sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
    // Send message via X API
  }
}
```

3. **Register in app.module.ts**:

```typescript
imports: [
  XModule, // Add your module
];
```

4. **Add to SocialMediaPlatform enum** in `src/types.ts`:

```typescript
export enum SocialMediaPlatform {
  Telegram = "telegram",
  X = "x",
  YourPlatform = "your-platform", // Add here
}
```

### Debugging Telegram Integration

```bash
# Check Telegram client logs
ls _td_database/user_<userId>/

# View client state
cat _td_database/user_<userId>/td.binlog

# Clean up stuck client
rm -rf _td_database/user_<userId>/

# Restart server to recreate client
yarn start:dev
```

---

## Debugging & Troubleshooting

### Common Issues and Solutions

#### 1. Database Connection Errors

```bash
# Error: "Connection terminated unexpectedly"
# Solution: Check PostgreSQL is running

# macOS
brew services list | grep postgresql

# Linux
sudo systemctl status postgresql

# Restart PostgreSQL if needed
# macOS
brew services restart postgresql@14

# Linux
sudo systemctl restart postgresql

# Check DATABASE_URL in .env
cat .env | grep DATABASE_URL

# Test connection
psql -h localhost -U your_username -d omni
```

#### 2. Redis Connection Errors

```bash
# Error: "ECONNREFUSED 127.0.0.1:6379"
# Solution: Check if Redis is running

# Test Redis connection
redis-cli ping
# Should return: PONG

# Start Redis if not running
# macOS
brew services start redis

# Linux
sudo systemctl start redis

# Or run Redis in foreground
redis-server
```

#### 3. Migration Errors

```bash
# Error: "Migration failed"
# Solution: Check current migration state
yarn mikro-orm migration:list

# Force reset (CAUTION: Dev only!)
yarn mikro-orm schema:drop --run
yarn migrations:up
```

#### 4. Telegram Client Won't Connect

```bash
# Check if TELEGRAM_API_ID and TELEGRAM_API_HASH are set
cat .env | grep TELEGRAM

# Remove stuck client session
rm -rf _td_database/user_<userId>/

# Check logs for specific error
# Look for TelegramProvider errors in console
```

#### 5. Pusher Events Not Working

```bash
# Verify Pusher credentials
cat .env | grep PUSHER

# Test Pusher auth endpoint
curl -X POST http://localhost:3000/api/v1/pusher/auth \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"socket_id":"123.456","channel_name":"private-messaging"}'
```

### Debugging Tips

1. **Enable Debug Logging**:

```typescript
// In any service
import { Logger } from "@nestjs/common";

export class YourService {
  private readonly logger = new Logger(YourService.name);

  someMethod() {
    this.logger.debug("Debug message here");
    this.logger.log("Info message");
    this.logger.warn("Warning message");
    this.logger.error("Error message", stackTrace);
  }
}
```

2. **Inspect Database State**:

```bash
# Connect to PostgreSQL
psql -h localhost -U your_username -d omni

# Useful queries
SELECT * FROM "user" WHERE email = 'user@example.com';
SELECT * FROM conversation WHERE platform = 'telegram';
SELECT * FROM message WHERE "conversationId" = 'some-uuid' ORDER BY "createdAt" DESC LIMIT 10;

# Exit psql
\q
```

3. **Monitor Queue Jobs**:

```bash
# Install BullMQ Board (optional)
yarn add @bull-board/api @bull-board/express

# Access queue dashboard at http://localhost:3000/queues
```

4. **Check Request IDs**:
   All API responses include a request ID in metadata. Use this to trace logs:

```typescript
// Response includes:
{
  "meta": {
    "requestId": "abc-123-def-456",
    "timestamp": "2025-10-26T12:00:00.000Z"
  }
}

// Search logs for this request ID
grep "abc-123-def-456" logs/app.log
```

---

## Code Navigation Tips

### Finding Your Way Around

#### Where to Start When...

**You need to add a new API endpoint:**

1. Go to `src/modules/<relevant-module>/`
2. Add DTO in `dto/` folder
3. Update service in `<module>.service.ts`
4. Add controller method in `<module>.controller.ts`

**You need to modify database schema:**

1. Update entity in `src/entities/<entity>.entity.ts`
2. Run `yarn migrations:create -n <description>`
3. Edit generated migration in `migrations/`
4. Run `yarn migrations:up`

**You need to debug message flow:**

1. Check `src/lib/social-media-registry/providers/<platform>/`
2. For Telegram: `telegram-event-listener.service.ts`
3. For others: `src/lib/queue/poll.processor.ts` and `message.processor.ts`

**You need to modify authentication:**

1. `src/modules/auth/auth.service.ts` - Auth logic
2. `src/common/guards/jwt-auth.guard.ts` - JWT validation
3. `src/config/jwt.config.ts` - JWT configuration

**You need to add/modify real-time events:**

1. `src/lib/pusher/pusher.service.ts` - Pusher integration
2. Trigger events from services using `this.pusherService.trigger()`

#### Key Directories Explained

```
src/
├── modules/           → Feature-based modules (add new features here)
├── entities/          → Database models (modify schema here)
├── lib/              → Shared libraries (reusable services)
│   ├── social-media-registry/  → Platform integrations
│   ├── queue/        → Background job processors
│   ├── pusher/       → Real-time communication
│   └── redis/        → Caching and temporary storage
├── common/           → Cross-cutting concerns
│   ├── guards/       → Authentication/authorization logic
│   ├── filters/      → Error handling
│   ├── interceptors/ → Response formatting
│   └── middleware/   → Request preprocessing
├── config/           → Configuration files (env vars)
└── database/         → Database initialization
```

### VS Code Tips

**Useful shortcuts:**

- `Cmd/Ctrl + P` → Quick file search
- `Cmd/Ctrl + Shift + F` → Search across files
- `F12` → Go to definition
- `Shift + F12` → Find all references

**Recommended extensions:**

- ESLint
- Prettier
- TypeScript Hero
- REST Client (for testing API endpoints)

---

## Performance & Best Practices

### Entity Manager Best Practices

**Always fork entity manager in async operations:**

```typescript
// ✅ Good - Prevents state pollution
const fork = this.em.fork();
const entity = fork.create(EntityClass, data);
await fork.persistAndFlush(entity);
fork.clear();

// ❌ Bad - Can cause race conditions
const entity = this.em.create(EntityClass, data);
await this.em.persistAndFlush(entity);
```

### Use Transactions for Multi-Entity Operations

```typescript
await this.em.transactional(async (em) => {
  const user = em.create(UserEntity, userData);
  const session = em.create(UserSocialSessionEntity, sessionData);
  session.user = user;
  await em.persistAndFlush([user, session]);
});
```

### Avoid N+1 Queries

```typescript
// ✅ Good - Eager load relationships
const conversations = await this.conversationRepo.findAll({
  populate: ["messages", "user"],
});

// ❌ Bad - N+1 query problem
const conversations = await this.conversationRepo.findAll();
for (const conv of conversations) {
  await conv.messages.loadItems(); // Extra query per conversation!
}
```

### Use Indexes for Frequent Queries

```typescript
@Entity()
@Index({ properties: ["platform", "externalId"] }) // Compound index
export class ConversationEntity {
  @Property()
  @Index() // Single column index
  platform: SocialMediaPlatform;

  @Property()
  externalId: string;
}
```

---

## Testing

### Unit Tests

```typescript
// Example: Testing a service
describe("MessageService", () => {
  let service: MessageService;
  let em: EntityManager;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MessageService,
        { provide: EntityManager, useValue: createMockEntityManager() },
      ],
    }).compile();

    service = module.get(MessageService);
    em = module.get(EntityManager);
  });

  it("should create a message", async () => {
    const result = await service.createMessage(mockData);
    expect(result).toBeDefined();
    expect(result.text).toBe(mockData.text);
  });
});
```

### Integration Tests

```bash
# Run tests
yarn test

# Run tests in watch mode
yarn test:watch

# Run e2e tests
yarn test:e2e

# Test coverage
yarn test:cov
```

---

## Deployment

### Production Build

```bash
# Build application
yarn build

# Start production server
yarn start:prod

# Or use PM2
pm2 start dist/main.js --name omni-backend
```

### Environment Configuration

Ensure all required environment variables are set in production:

- Use strong `JWT_SECRET` and `JWT_REFRESH_SECRET`
- Use production Pusher credentials
- Configure `DATABASE_URL` with SSL enabled
- Set `NODE_ENV=production`
- Configure proper `REDIS_HOST` and `REDIS_PASSWORD`

### Database Migrations in Production

```bash
# Always run migrations before deploying new code
yarn migrations:up

# Check migration status
yarn mikro-orm migration:list
```

---

## Known Limitations & TODOs

1. Message edit and delete handling in event listener (marked TODO)
2. Message sending implementation incomplete (role field nullable)
3. X/Instagram/LinkedIn providers have framework but no implementation
4. Contact sync scheduler in progress
5. Conversation doctor scheduler for metadata fixes

---

## Additional Resources

- [NestJS Documentation](https://docs.nestjs.com/)
- [MikroORM Documentation](https://mikro-orm.io/)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [Pusher Documentation](https://pusher.com/docs/)
- [Telegram TDLib Documentation](https://core.telegram.org/tdlib)

---

## Getting Help

- Check the [Debugging & Troubleshooting](#debugging--troubleshooting) section
- Review existing code in similar modules
- Ask the team in #backend channel
- Consult NestJS/MikroORM documentation

---

**Last Updated**: October 2025
