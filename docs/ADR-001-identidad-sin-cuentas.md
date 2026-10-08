# ADR-001 — Identidad sin cuentas: token opaco en la URL

- **Fecha:** 2026-10-08
- **Estado:** aceptado
- **Decisor:** Arquitecto (Hornada, ciclo 1)

## Contexto

El cliente tiene que poder **volver a ver su reserva** (C-20) y el cocinero tiene que
ver **solo sus pedidos** (C-18). Eso exige distinguir quién pregunta.

Pero el ciclo 1 declaró explícitamente (A4, ratificado en G1) que **no hay
verificación de identidad**: verificar quién es alguien cuesta operación —documento,
teléfono, revisión humana— y es exactamente lo que se difirió. Un login real
(email + contraseña, o un tercero) trae gestión de identidad, recuperación de clave y
una promesa de seguridad que el producto todavía no puede sostener.

## Decisión

Cada cocinero y cada reserva reciben al crearse un **token opaco aleatorio**
(`crypto.randomUUID()`), que viaja en la URL. Ese token es la llave:

- el cocinero entra a su panel con `?token=…`;
- el cliente consulta su reserva con su `codigo`, y califica con él.

No hay cuentas, no hay contraseñas, no hay sesiones. El token **no es una
credencial de plataforma**: es un identificador no adivinable, guardado en la base.

## Alternativas descartadas

| Alternativa | Por qué se descartó |
|---|---|
| Cuenta con email + contraseña | Agrega gestión de identidad completa (alta, recuperación, hashing, fuga de credenciales) para un piloto de un barrio. Es la mitad de una etapa que no está en el alcance |
| Login con un tercero (Google/Apple) | Dependencia externa, consentimiento y una cuenta que el vecino quizá no quiere dar. Además **verifica identidad**, que es justo lo que A4 difiere |
| Cookie de sesión con un id propio | Técnicamente igual al token, pero sin URL compartible: el cliente no puede volver a su pedido desde otro dispositivo ni desde un enlace que se guardó |
| Sin token: `/api/cocineros/mi-panel` sin llave | Viola C-18 y C-20 de inmediato: cualquiera vería los pedidos de todos, con nombre, contacto y dirección |

## Consecuencias

**Positivas:**
- Cero fricción para entrar: el vecino reserva con nombre y contacto, nada más.
- El enlace que se guarda **es** el acceso: no hay nada que recordar.
- Nada de gestión de credenciales en el ciclo 1 → superficie de ataque mínima.

**Negativas / costo asumido:**
- Un token en la URL puede filtrarse por historial, capturas o reenvíos. Se acepta:
  lo que protege es **débil** —el nombre, el contacto y una dirección de entrega de
  un vecino— y es el mismo nivel de exposición que un grupo de WhatsApp del barrio.
- No hay forma de "recuperar" el acceso si se pierde el enlace. Mitigación: el
  cocinero ve su token en su propia pantalla después de publicar; el cliente puede
  volver a pedir el código en la misma pantalla de confirmación.

**Qué se vuelve difícil después de esto:**
- Verificar *quién* es el cocinero. Cuando el producto quiera certificar (ciclo 2 o 3),
  va a necesitar cuentas de verdad, y este ADR queda **reemplazado**, no extendido.
- Revocar el acceso de alguien sin migrar el esquema.
