import flet as ft
from split_loot_processor import process_hunting_session

def split_loot_view(page: ft.Page):
    # Resultado dinámico
    result_text = ft.Text(value="Aquí se mostrarán los resultados.", selectable=True)
    result_container = ft.Container(
        content=result_text,
        padding=20,
        expand=True,
    )

    # Campo de texto para hunting session
    hunting_input = ft.TextField(
        label="Hunting Session",
        multiline=True,
        min_lines=10,
        max_lines=10,
        width=400,
        expand=False,
    )

    # Opciones avanzadas
    advanced_options_dialog = ft.AlertDialog(
        modal=True,
        title=ft.Text("Opciones Avanzadas"),
        content=ft.Column([
            ft.Text("Aquí puedes agregar configuraciones avanzadas."),
            ft.Checkbox(label="Incluir waste"),
            ft.Checkbox(label="Auto repartir profit"),
        ]),
        actions=[ft.TextButton("Cerrar", on_click=lambda e: page.dialog.dismiss())],
    )

    def handle_split(e):
        if not hunting_input.value.strip():
            result_text.value = "Por favor, pega el Hunting Session."
            page.update()
            return
        try:
            result, players, transfers, avg, total, session_info = process_hunting_session(hunting_input.value)
            result_text.value = result
        except Exception as ex:
            result_text.value = f"Ocurrió un error al procesar el texto:\n{str(ex)}"
        page.update()

    # Botón opciones avanzadas
    open_dialog_btn = ft.ElevatedButton("Opciones Avanzadas", on_click=lambda e: page.dialog.open())

    # Botón Split
    split_btn = ft.ElevatedButton("Split", on_click=handle_split)

    # Asignar diálogo
    page.dialog = advanced_options_dialog

    return ft.Row(
        [
            ft.Column(
                [
                    hunting_input,
                    ft.Row(
                        [open_dialog_btn, split_btn],
                        alignment=ft.MainAxisAlignment.START,
                        spacing=20,
                    ),
                ],
                expand=2,
                spacing=0,
            ),
            ft.VerticalDivider(width=1),
            result_container,
        ],
        expand=True,
    )
