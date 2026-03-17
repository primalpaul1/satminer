# SatMiner - Custom Nostr Event Kinds

## Kind 35303 — Game Lobby (Addressable)

Represents a SatMiner game room. Created by the host when they create a new game. Updated as players join and the game status changes.

### Tags

| Tag | Required | Description |
|-----|----------|-------------|
| `d` | Yes | Unique game identifier |
| `bet` | Yes | Bet amount in satoshis |
| `seed` | Yes | Deterministic seed for generating the game grid and bitcoin position |
| `status` | Yes | Game status: `waiting`, `playing`, or `finished` |
| `max_players` | No | Maximum number of players (default: 8) |
| `p` | No | Pubkeys of players who have joined (one tag per player, excludes host) |
| `t` | Yes | Always `satminer` for discoverability |
| `alt` | Yes | NIP-31 human-readable description |

### Example

```json
{
  "kind": 35303,
  "content": "",
  "tags": [
    ["d", "satminer-1710000000000-abc123"],
    ["bet", "100"],
    ["seed", "satminer-1710000000000-abc123-pubkey-1710000000000"],
    ["status", "waiting"],
    ["max_players", "8"],
    ["p", "<player2-pubkey>"],
    ["t", "satminer"],
    ["alt", "SatMiner game lobby - a multiplayer Bitcoin mining game"]
  ]
}
```

## Kind 1159 — Game Action (Regular)

Represents a player action during gameplay (movement, mining). Published in real-time as players interact with the game.

### Tags

| Tag | Required | Description |
|-----|----------|-------------|
| `d` | Yes | Game identifier (matches the lobby's `d` tag) |
| `e` | No | Reference to the lobby event ID (used for join actions) |
| `p` | No | Reference to the host pubkey (used for join actions) |
| `t` | Yes | Always `satminer` |
| `alt` | Yes | NIP-31 human-readable description |

### Content

JSON-encoded action object:

```json
{ "type": "move", "direction": "down" }
{ "type": "swing" }
{ "type": "join" }
```

### Action Types

| Type | Description | Fields |
|------|-------------|--------|
| `move` | Player moves in a direction | `direction`: `up`, `down`, `left`, `right` |
| `swing` | Player swings their pickaxe | — |
| `join` | Player requests to join a game | — |

## Kind 7107 — Game Result (Regular)

Published when a player finds the Bitcoin and wins the game.

### Tags

| Tag | Required | Description |
|-----|----------|-------------|
| `d` | Yes | Game identifier |
| `p` | Yes | Host pubkey |
| `t` | Yes | Always `satminer` |
| `alt` | Yes | NIP-31 human-readable description |

### Content

```json
{ "result": "win", "gameId": "satminer-1710000000000-abc123" }
```
