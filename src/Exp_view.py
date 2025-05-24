import flet as ft
import requests
import math

def Exp_view(page: ft.Page):
    name_input = ft.TextField(label="Nombre del personaje", width=300)
    level_input = ft.TextField(label="Nivel (opcional)", width=300, keyboard_type=ft.KeyboardType.NUMBER)
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
                    result_text.value = f"⚠️ Personaje '{nombre}' no encontrado."
                else:
                    level = data["character"]["character"]["level"]
                    min_lvl, max_lvl = calcular_rango(level)
                    result_text.value = f"🧍 {nombre} (Nivel {level}) puede sharear con niveles de {min_lvl} a {max_lvl}."
            except Exception as ex:
                result_text.value = f"❌ Error consultando la API: {str(ex)}"
        elif nivel:
            try:
                level = int(nivel)
                min_lvl, max_lvl = calcular_rango(level)
                result_text.value = f"🔢 Nivel {level} puede sharear con niveles de {min_lvl} a {max_lvl}."
            except ValueError:
                result_text.value = "⚠️ Ingresa un nivel válido."
        else:
            result_text.value = "⚠️ Ingresa al menos un nombre o un nivel."

        name_input.value = ""
        level_input.value = ""
        page.update()

    # ⬇️ Este contenedor soluciona la alineación en Web y Escritorio
    return ft.Container(
    content=ft.Column(
        controls=[...],
        expand=True
    ),
    expand=True,
    alignment=ft.alignment.top_left 
    )
