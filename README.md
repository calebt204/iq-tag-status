# IQ Tag Status

Public NFC sticker page for **PressurePro IQ**.

An NFC tag stores a URL. A phone opens it, API Gateway calls this Lambda, and the Lambda returns a read-only HTML page of the unit’s latest tire pressures and temperatures from RDS.

```
https://tag.<domain>/t/<base64url(unitId.companyId)>
        │
        API Gateway HTTP API   GET /t/{code}
        │
        Lambda (this repo)
        │
        MySQL / RDS  (pUnit + pSensor.lastReading)
```

## Sticker code

Concatenate `unitId` and `companyId` with a **dot**, then base64url-encode:

| Step | Value |
|------|-------|
| Payload | `100234.1001` |
| Path segment | `MTAwMjM0LjEwMDE` |
| URL | `https://tag.example.com/t/MTAwMjM0LjEwMDE` |

A raw join like `1002341001` → `MTAwMjM0MTAwMQ==` is ambiguous and is rejected.

Generate a URL locally:

```bash
npm run encode -- 100234 1001 https://tag.example.com
```

## Local development

```bash
npm install
npm test
npm run typecheck
npm run build
npm run package   # writes function.zip
```

## AWS setup

### 1. Database user

On the IQ RDS instance:

```sql
CREATE USER 'tag_status'@'%' IDENTIFIED BY '<password>';
GRANT SELECT ON <db>.pUnit TO 'tag_status'@'%';
GRANT SELECT ON <db>.pSensor TO 'tag_status'@'%';
FLUSH PRIVILEGES;
```

Prefer locking the host pattern to the Lambda subnet instead of `%` when you know it.

### 2. Lambda

1. Create a Node.js 20 function in the **same VPC** as RDS (private subnets).
2. Security group: allow outbound TCP **3306** to the RDS security group. On RDS, allow inbound **3306** from the Lambda security group.
3. Runtime settings: **256 MB**, timeout **5 seconds**.
4. Handler: `handler.handler`
5. Environment variables:

| Name | Example |
|------|---------|
| `MYSQL_HOST` | `your-rds-endpoint.region.rds.amazonaws.com` |
| `MYSQL_USER` | `tag_status` |
| `MYSQL_PASS` | *(from Secrets Manager preferred)* |
| `MYSQL_DB` | `connect` |
| `MYSQL_PORT` | `3306` |

6. Upload `function.zip` from `npm run package`.

### 3. API Gateway HTTP API

1. Create an **HTTP API** (not REST).
2. Route: `GET /t/{code}` → Lambda integration (payload format 2.0).
3. Default stage throttle: a few requests per second is enough for yard taps.
4. Custom domain `tag.<domain>` with an ACM cert in the same region, mapped to the stage.
5. No authorizer — the path itself is the credential.

### 4. Program the tag

Write the URL as an NDEF URI record, then lock the tag.

## Response behavior

| Case | Result |
|------|--------|
| Valid code, unit exists and is not deleted | `200` HTML with unit name + active sensors |
| Bad / unknown / mismatched company | `404` generic “Unit not found” |
| Database or unexpected failure | `503` generic error page |

The page shows pressure (PSI), temperature (°F), position, and reading time. It does **not** render location, device ids, or sensor serials.

## Notes

- Base64 here is encoding, not secrecy. Anyone can decode the path. The Lambda still requires `pUnit.id` and `pUnit.companyId` to match.
- A random opaque token is safer long-term if stickers may be photographed or copied. This repo implements the concatenated-id approach requested for the first pass.
