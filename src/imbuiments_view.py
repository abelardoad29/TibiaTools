import flet as ft

def imbuiments(page: ft.Page):
    return ft.Row(
        [
            ft.Container(
                content=ft.Text("Void"),
                margin=10,
                padding=10,
                alignment=ft.alignment.center,
                bgcolor=ft.Colors.BLUE_700,
                width=150,
                height=150,
                border_radius=10,
                ink=True,
                on_click=lambda e: print("Clickable with Ink clicked!"),
            ),
        ],
        alignment=ft.MainAxisAlignment.START,
    )
