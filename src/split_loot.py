import flet as ft
import re

def parse_session_text(session_text):
    players = []
    lines = session_text.strip().split('\n')

    if len(lines) < 7:
        raise ValueError("El texto de sesión es demasiado corto para contener datos válidos.")

    total_loot = total_supplies = total_balance = 0
    for line in lines[:6]:
        line = line.strip()
        if line.startswith("Loot:") and 'Supplies' not in line:
            total_loot = int(line.split(":")[1].replace(",", "").strip())
        elif line.startswith("Supplies:"):
            total_supplies = int(line.split(":")[1].replace(",", "").strip())
        elif line.startswith("Balance:"):
            total_balance = int(line.split(":")[1].replace(",", "").strip())

    idx = 6
    while idx + 5 < len(lines):
        name_line = lines[idx].strip()
        name = name_line.replace(" (Leader)", "")
        leader = "(Leader)" in name_line

        loot = int(lines[idx + 1].split(":")[1].replace(",", "").strip())
        supplies = int(lines[idx + 2].split(":")[1].replace(",", "").strip())
        balance = int(lines[idx + 3].split(":")[1].replace(",", "").strip())
        damage = int(lines[idx + 4].split(":")[1].replace(",", "").strip())
        healing = int(lines[idx + 5].split(":")[1].replace(",", "").strip())

        players.append({
            "name": name,
            "leader": leader,
            "loot": loot,
            "supplies": supplies,
            "balance": balance,
            "damage": damage,
            "healing": healing
        })

        idx += 6

    if not players:
        raise ValueError("No se encontraron datos de jugadores.")

    individual_balance = total_balance // len(players)
    transfers = []

    for p in players:
        p["diff"] = p["balance"] - individual_balance

    payers = [p for p in players if p["diff"] > 0]
    receivers = [p for p in players if p["diff"] < 0]

    for payer in payers:
        for receiver in receivers:
            if payer["diff"] <= 0:
                break
            amount = min(payer["diff"], -receiver["diff"])
            if amount > 0:
                transfers.append({
                    "from": payer["name"],
                    "to": receiver["name"],
                    "amount": amount
                })
                payer["diff"] -= amount
                receiver["diff"] += amount

    return individual_balance, transfers


def split_loot_view(page: ft.Page):
    session_input = ft.TextField(
        label="Pega aquí el texto de la sesión",
        multiline=True,
        min_lines=10,
        max_lines=20,
        height=200,
        expand=True
    )

    result_column = ft.Column()
    current_transfers_text = []

    def copy_to_clipboard(text):
        page.set_clipboard(text)
        page.snack_bar = ft.SnackBar(ft.Text("¡Texto copiado al portapapeles!"))
        page.snack_bar.open = True
        page.update()

    def calculate_session(e):
        nonlocal current_transfers_text
        result_column.controls.clear()
        current_transfers_text = []

        try:
            individual_balance, transfers = parse_session_text(session_input.value)
            result_column.controls.append(ft.Text(f"Balance individual: {individual_balance:,} gp", weight="bold"))

            for t in transfers:
                text = f"transfer {t['amount']} to {t['to']}"
                current_transfers_text.append(text)
                result_column.controls.append(
                    ft.Row([
                        ft.Text(f"{t['from']} -> {t['to']}: {t['amount']:,} gp", expand=True),
                        ft.ElevatedButton("Copiar", on_click=lambda e, txt=text: copy_to_clipboard(txt))
                    ])
                )

            if transfers:
                result_column.controls.append(
                    ft.ElevatedButton(
                        "Copiar todas las transferencias",
                        on_click=lambda e: copy_to_clipboard("\n".join(current_transfers_text))
                    )
                )
        except Exception as ex:
            result_column.controls.append(ft.Text(f"Error al procesar: {ex}", color=ft.colors.RED))

        page.update()

    return ft.Column(
        controls=[
            ft.Text("Split Loot - Calculadora de Profit", size=20, weight="bold"),
            session_input,
            ft.ElevatedButton("Calcular", on_click=calculate_session),
            result_column
        ],
        scroll=ft.ScrollMode.AUTO,
        expand=True
    )
