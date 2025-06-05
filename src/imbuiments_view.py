import flet as ft
import json
import os

# Cargar datos del archivo JSON - "src", 
with open(os.path.join("imbuiments.json"), "r") as f:
    IMBUIMENTS = json.load(f)


def ImbuementCalculator():
    # Dropdowns para seleccionar imbuement y nivel
    imbuement_dropdown = ft.Dropdown(
        label="Imbuement",
        options=[ft.dropdown.Option(name) for name in IMBUIMENTS.keys()],
        value="Vampirism"
    )

    tier_dropdown = ft.Dropdown(
        label="Tier",
        options=[ft.dropdown.Option(tier) for tier in ["Basic", "Intricate", "Powerful"]],
        value="Powerful"
    )

    # Input para el precio del Gold Token
    gold_token_price_input = ft.TextField(
        label="Gold Token Price",
        value="10000",
        width=200,
        keyboard_type=ft.KeyboardType.NUMBER
    )

    # Texto para mostrar el costo total
    total_cost_text = ft.Text("0 gp", size=16, weight="bold", color=ft.Colors.ORANGE)

    # Contenedor para los materiales
    materials_column = ft.Column()

    # Lista para guardar inputs de precios y sus cantidades
    material_price_inputs = []

    # Función para calcular y comparar precios
    def calculate_total():
        try:
            token_price = int(gold_token_price_input.value)
        except ValueError:
            token_price = 0

        tier = tier_dropdown.value
        tier_multiplier = {"Basic": 2, "Intricate": 4, "Powerful": 6}.get(tier, 0)
        token_cost = token_price * tier_multiplier

        total = 0

        for qty, price_input, icon in material_price_inputs:
            try:
                item_price = int(price_input.value)
            except ValueError:
                item_price = 0

            item_total = item_price * qty
            total += item_total

            if item_total < token_cost:
                # Si el material es más barato
                icon.content = ft.Image(src="The_Market_(Object).gif")  # Cambia este por tu GIF de materiales más baratos
            else:
                # Si el token es más barato
                icon.content = ft.Image(src="Gold_Token.gif")  # Cambia este por tu GIF de token más barato

            icon.update()

        total_cost_text.value = f"{total:,} gp"
        total_cost_text.update()

    # Función para actualizar los materiales mostrados
    def update_materials(e=None):
        imbuement = imbuement_dropdown.value
        tier = tier_dropdown.value
        materials = IMBUIMENTS.get(imbuement, {}).get(tier, [])
        materials_column.controls.clear()
        material_price_inputs.clear()

        for material in materials:
            qty = material["qty"]
            name_text = ft.Text(material["name"], size=14)
            qty_label = ft.Container(
                content=ft.Text(f"{qty}x", size=14, weight="bold"),
                bgcolor="yellow600",
                padding=ft.padding.symmetric(horizontal=10, vertical=5),
                border_radius=10
            )

            price_input = ft.TextField(
                hint_text="Current price",
                width=150,
                keyboard_type=ft.KeyboardType.NUMBER,
                on_change=lambda e: calculate_total()
            )

            comparison_icon = ft.Container(
                content=ft.Text("📦"),  # Placeholder inicial
                padding=10,
                bgcolor="gray100",
                border_radius=10
            )

            material_price_inputs.append((qty, price_input, comparison_icon))

            row = ft.Row(
                controls=[
                    qty_label,
                    ft.Column([name_text, price_input]),
                    comparison_icon
                ],
                alignment="spaceBetween",
                vertical_alignment="center"
            )

            materials_column.controls.append(row)

        materials_column.update()
        calculate_total()

    # Conectar eventos de cambio
    imbuement_dropdown.on_change = update_materials
    tier_dropdown.on_change = update_materials
    gold_token_price_input.on_change = lambda e: calculate_total()

    # Inicializar materiales
    #update_materials()

    return ft.Container(
        content=ft.Column(
            controls=[
                ft.Text("IMBUEMENTS", size=10, weight="bold", color="Black"),
                  # Input del precio del token
                ft.Row(controls=[gold_token_price_input, imbuement_dropdown, tier_dropdown], spacing=10),
                ft.Divider(),
                materials_column,
                ft.Divider(),
                ft.Row(
                    controls=[
                        ft.Text("Total cost 🧮", size=14, weight="bold"),
                        total_cost_text
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
  
    page.timer(0.1, update_materials)  #Espera 100 ms a que el componente se agregue

    def did_mount(self):
        self.update_materials()
# Al final de ImbuementCalculator()
 