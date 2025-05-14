import re

def clean_number(value):
    try:
        cleaned = (
            value.replace("−", "-")  # signo menos unicode
                  .replace("–", "-")  # guion largo
                  .replace(",", "")  # quita comas
                  .strip()
        )
        return int(cleaned)
    except Exception as e:
        print(f"[ERROR] Fallo al convertir: '{value}' → '{cleaned}'")
        raise e

def process_hunting_session(text):
    lines = text.strip().splitlines()
    session_info = {}
    players = []
    current_player = None

    for line in lines:
        line = line.strip()
        
        # Procesamiento de información general de la sesión
        if line.startswith("Session data:"):
            session_info["session_data"] = line.replace("Session data: ", "").strip()
        elif line.startswith("Session:"):
            session_info["duration"] = line.replace("Session: ", "").strip()
        elif line.startswith("Loot Type:"):
            session_info["loot_type"] = line.replace("Loot Type: ", "").strip()
        elif line.startswith("Loot:") and "session_loot" not in session_info:
            session_info["session_loot"] = clean_number(line.split(":")[1])
        elif line.startswith("Supplies:") and "session_supplies" not in session_info:
            session_info["session_supplies"] = clean_number(line.split(":")[1])
        elif line.startswith("Balance:") and "session_balance" not in session_info:
            session_info["session_balance"] = clean_number(line.split(":")[1])

        # Procesamiento de jugadores
        elif line and not line.startswith("\t") and not line.startswith(" "):  # Detecta líneas con nombre de jugador
            if current_player is not None:  # Guardamos el jugador anterior si existe
                players.append(current_player)

            current_player = {"name": line}  # Asignamos un nuevo jugador
        elif current_player:
            if "Loot:" in line:
                current_player["loot"] = clean_number(line.split(":")[1])
            elif "Supplies:" in line:
                current_player["supplies"] = clean_number(line.split(":")[1])
            elif "Balance:" in line:
                current_player["balance"] = clean_number(line.split(":")[1])
            elif "Damage:" in line:
                current_player["damage"] = clean_number(line.split(":")[1])
            elif "Healing:" in line:
                current_player["healing"] = clean_number(line.split(":")[1])

    # Agregar el último jugador (si lo hay)
    if current_player is not None:
        players.append(current_player)

    # Validación final
    for p in players:
        if "balance" not in p:
            raise ValueError(f"Jugador {p['name']} no tiene balance definido.")

    total_balance = sum(p["balance"] for p in players)
    avg_balance = round(total_balance / len(players))

    for p in players:
        p["diff"] = p["balance"] - avg_balance

    givers = sorted([p for p in players if p["diff"] > 0], key=lambda x: -x["diff"])
    receivers = sorted([p for p in players if p["diff"] < 0], key=lambda x: x["diff"])

    transfers = []
    for giver in givers:
        give_amount = giver["diff"]
        for receiver in receivers:
            if receiver["diff"] == 0:
                continue
            need_amount = -receiver["diff"]
            amount = min(give_amount, need_amount)
            if amount > 0:
                transfers.append({
                    "from": giver["name"],
                    "to": receiver["name"],
                    "amount": amount
                })
                giver["diff"] -= amount
                receiver["diff"] += amount
                give_amount -= amount

    # Formato de resultado
    date_part = session_info['session_data'].split(',')[0]
    weekday = session_info['session_data'].split(',')[1].strip()
    result_text = f"Team session\n{date_part} ({weekday})\n\nTransfers\n"
    copy_lines = []
    for t in transfers:
        result_text += f"{t['from']} {t['amount']:,} to {t['to']}\n"
        copy_lines.append(f"Copy: transfer {t['amount']:,} to {t['to']}")

    result_text += "\n" + "\n".join(copy_lines)
    result_text += f"\n\nTotal profit\n{total_balance:,}\neach {avg_balance:,}"

    return result_text, players, transfers, avg_balance, total_balance, session_info
