# Balance Reconciliation

Difference = (Payout + Payin + Other party payments) − Bank accounts − Other uses

## Start
1. Install Node.js 18 or newer.
2. In this folder run: `node server.js`
3. Open http://localhost:3000 on this PC. Staff on the office network open http://<this-pc-ip>:3000

First time: create the admin user ID and password. The admin adds staff under **Users**.
To change the port, edit `config.json`.

## Pages
- **Dashboard**: the live formula, today's and this month's profit/loss, change since last closing,
  difference trend, daily P&L chart, alerts (API failures, new accounts, big movements, flagged rows),
  where the money is, largest wallets, API status and today's activity.
- **Sheet**: all sections. API rows update from the APIs; manual rows are typed in. Flag, note, row history.
- **Recon data**: compare today (live) or any closing with any other closing. Shows how the difference
  moved section by section, and every row's opening, closing and movement.
- **Profit & loss**: add income and expense entries (category, party, amount, note), filter and export.
- **Reports**: Today / 7 days / month / last month / year / custom. Income, expenses, net profit,
  funds position change, daily P&L chart, difference trend, income and expenses by category,
  by party, biggest balance movements, daily statement. Export and print.
- **Day-end closing**: close today (locks entries), history of all closings with P&L, view, compare, reopen (admin).
- **Activity log**: every change with who, IP address, device, before and after. Filter and export.
- **API connections** (admin), **Users** (admin), **Settings** (admin).

## Adding an API (admin → API connections)
1. Click **Add API connection**. Give it a name and choose where balances go:
   Payout wallets, Payin wallets or Bank accounts.
2. Enter the URL, method, and headers (API key / token). For POST, add the JSON body.
3. Click **Test connection**. It shows the lists and fields the API returned and fills in the
   likely fields. Check them:
   - *List of accounts is in*: e.g. `data.wallets`
   - *Account name field*: e.g. `merchant.name`
   - *Balance field*: e.g. `available`
   - *Unique ID field* (optional): e.g. `walletId` or account number
4. Save, then click **Refresh now** on the connection.
5. Click **Choose accounts** and tick the wallets or bank accounts that belong in the sheet.
   Unticked ones are ignored. New accounts found later wait for you, unless you turn on
   "Add new accounts automatically".

If a manual row in the sheet has the same name as an API account you tick, that row is linked to the
API (its notes and history are kept). Deleting a connection keeps its rows as manual entries.
Saved API keys are never shown in full again.

## Who can do what
| | Staff | Admin |
|---|---|---|
| Enter and edit sheet data, add income and expenses | Yes | Yes |
| Refresh API balances, view reports, recon, log | Yes | Yes |
| Close the day | Yes | Yes |
| Delete rows and P&L entries | No | Yes |
| Reopen a closed day, add entries to a closed day | No | Yes |
| API connections, users, settings | No | Yes |

## Profit and loss
Net profit = income entries − expense entries (categories are set in Settings).
Funds position change = how much the gap between money held and money owed improved over a period,
taken from day-end closings. Both appear in Reports.

## Data and backup
Everything is stored in `data/`: users (passwords hashed), sheet, API connections, P&L entries,
closings, settings, and one activity-log file per day in `data/audit/`. Back up this folder daily.

Forgot the only admin password? Stop the server, delete `data/users.json`, start again and create
a new admin. Everything else is kept.

Using it outside the office network: put it behind https first so passwords are encrypted.

## Changing the screens
The interface source is in `ui/`. After editing, run `python3 build.py` to rebuild `public/index.html`.
