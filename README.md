# Balance Reconciliation

Difference = (Payout + Payin + Other party payments) − Bank accounts − Other uses

## Start
1. Install Node.js 18 or newer.
2. In this folder run: `node server.js`
3. Open http://localhost:3000 on this PC. Staff on the office network open http://<this-pc-ip>:3000

The first time you open it, it asks you to create the **admin** user ID and password.
The admin then adds staff in the **Users** tab.

## Who can do what
| | Staff | Admin |
|---|---|---|
| Enter and edit amounts, names, notes, flags | Yes | Yes |
| Refresh API balances | Yes | Yes |
| See the activity log and closings | Yes | Yes |
| Close the day | Yes | Yes |
| Delete rows | No | Yes |
| Reopen a closed day | No | Yes |
| Add people, reset passwords, disable accounts | No | Yes |

## Activity log
Every change is recorded with: time, who, their IP address and device (browser and PC/phone),
section, row, field, the value before and the value after. Logins, failed logins, API refreshes
(with each changed balance), closings and user changes are recorded too.
Click 🕘 on any row to see its full history across all days. Each row also shows who last changed it.

## Day-end closing
"Close today" saves the full sheet and totals for the day and locks entries until the next day.
The closing list shows every day's figures, the change in the difference from the previous closing,
who closed it, and remarks. "View" opens that day's full sheet, which can be exported to Excel.
An admin can reopen a day if a correction is needed (this is logged).

The business day follows `timezone` in config.json (default Asia/Kolkata; use Asia/Dubai if needed).

## Connect your APIs (config.json)
For each source (`payout`, `payin`, `banks`): set `enabled` to true and fill `url`, `method` and `headers`
(tokens stay on the server). Then tell it where the data is:
- `listPath`: where the list sits in the response, e.g. `data` (empty if the response itself is the list)
- `nameField`: the account / customer name field, e.g. `name`
- `balanceField`: the balance field, e.g. `balance`

Example response `{"data":[{"name":"Kio It Solutions","balance":9001903}]}` →
`listPath: "data"`, `nameField: "name"`, `balanceField: "balance"`.

`autoRefreshMinutes`: set to e.g. 15 to refresh API balances automatically on the server (0 = off).
Restart the server after editing config.json.

## Data and backup
Everything is stored in the `data/` folder: users (passwords are stored hashed), the live sheet,
closings, and one activity-log file per day in `data/audit/`. Back up this folder daily.

Forgot the only admin password? Stop the server, delete `data/users.json`, start again and
create a new admin. The sheet, log and closings are kept.

## Using it outside the office
It runs over plain http, which is fine inside an office network. To use it over the internet,
put it behind https (a hosting provider or reverse proxy) so passwords travel encrypted.
