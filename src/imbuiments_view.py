import flet as ft
import json
import os

# Cargar datos del archivo JSON
with open(os.path.join("src", "imbuiments.json"), "r") as f:
    IMBUIMENTS = json.load(f)



def ImbuementCalculator():
    # Dropdowns para seleccionar imbuement y nivel
    imbuement_dropdown = ft.Dropdown(
        label="Imbuiment",
        options=[ft.dropdown.Option(name) for name in IMBUIMENTS.keys()],
        value="Vampirism"
    )

    tier_dropdown = ft.Dropdown(
        label="Tier",
        options=[ft.dropdown.Option(tier) for tier in ["Basic", "Intricate", "Powerful"]],
        value="Powerful"
    )

    # Contenedor para los materiales
    materials_column = ft.Column()

    # Función para actualizar los materiales mostrados
    def update_materials(e=None):
        imbuement = imbuement_dropdown.value
        tier = tier_dropdown.value
        materials = IMBUIMENTS.get(imbuement, {}).get(tier, [])
        materials_column.controls = []

        for material in materials:
            qty_label = ft.Container(
                content=ft.Text(f"{material['qty']}x", size=14, weight="bold"),
                bgcolor="yellow600",
                padding=ft.padding.symmetric(horizontal=10, vertical=5),
                border_radius=10
            )

            name = ft.Text(material["name"], size=14)
            price_input = ft.TextField(hint_text="Current price", width=120)

            # Icono comparativo (por ahora placeholder)
            comparison_icon = ft.Container(
                content=ft.Text("📦"),  # Cambiar a 🪙 si es más barato el token
                padding=10,
                bgcolor="gray100",
                border_radius=10
            )

            row = ft.Row(
                controls=[
                    qty_label,
                    ft.Column([name, price_input]),
                    comparison_icon
                ],
                alignment="spaceBetween",
                vertical_alignment="center"
            )
            materials_column.controls.append(row)

        materials_column.update()

    # Asignar la función a los eventos de cambio
    imbuement_dropdown.on_change = update_materials
    tier_dropdown.on_change = update_materials

    # Inicializar materiales
    #update_materials()

    return ft.Container(
        content=ft.Column(
            controls=[
                ft.Text("IMBUIMENTS", size=10, weight="bold", color="Black"),
                ft.Row(controls=[imbuement_dropdown, tier_dropdown], spacing=10),
                ft.Divider(),
                materials_column,
                ft.Divider(),
                ft.Row(
                    controls=[
                        ft.Text("Total cost 🧮", size=14, weight="bold"),
                        ft.Text("0", size=16, weight="bold", color=ft.Colors.ORANGE)
                    ],
                    alignment="spaceBetween"
                )
            ],
            spacing=20,
            scroll=ft.ScrollMode.AUTO,
        ),
        padding=20,
        bgcolor=ft.Colors.with_opacity(0.04, ft.Colors.BLACK),
        border_radius=10,
        expand=True,
    )
