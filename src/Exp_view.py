import flet as ft
import requests
import math

def Exp_view(page: ft.Page):
    name_input = ft.TextField(label="Name", width=300)
    level_input = ft.TextField(label="Level (optional)", width=300, keyboard_type=ft.KeyboardType.NUMBER)
    result_text = ft.Text()

    def calcular_rango(level: int):
        min_lvl = math.floor(level * (2 / 3))
        max_lvl = math.ceil(level * (3 / 2))
        return min_lvl, max_lvl

    def on_click(e):
        result_text.value = ""
        nombre = name_input.value.strip()
        nivel = level_input.value.strip()

        if nombre:
            try:
                res = requests.get(f"https://api.tibiadata.com/v4/character/{nombre}")
                data = res.json()

                if data.get("information", {}).get("status", {}).get("http_code") == 502:
                    result_text.value = f"⚠️ Player '{nombre}' not found."
                else:
                    level = data["character"]["character"]["level"]
                    min_lvl, max_lvl = calcular_rango(level)
                    result_text.value = f"🧍 {nombre} (Nivel {level}) can share from {min_lvl} to {max_lvl}."
            except Exception as ex:
                result_text.value = f"❌ Error consulting API: {str(ex)}"
        elif nivel:
            try:
                level = int(nivel)
                min_lvl, max_lvl = calcular_rango(level)
                result_text.value = f"🔢 Nivel {level} can share from {min_lvl} to {max_lvl}."
            except ValueError:
                result_text.value = "⚠️ Please add a valid number"
        else:
            result_text.value = "⚠️ Add at least a number or a name."

        name_input.value = ""
        level_input.value = ""
        page.update()

    button = ft.ElevatedButton("Share", on_click=on_click)

    return ft.Container(
        content=ft.Column(
            controls=[
                ft.Text("Share Exp", size=14, weight=ft.FontWeight.BOLD, color="black"),
                name_input,
                level_input,
                button,
                result_text
            ],
            expand=True
        ),
        expand=True,
        alignment=ft.alignment.top_left,
    )
