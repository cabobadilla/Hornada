-- 0001_init — esquema ciclo 1, tomado tal cual de 04-DISENO.md
CREATE TABLE cocineros (
  id                 TEXT PRIMARY KEY,
  nombre             TEXT NOT NULL,
  sector             TEXT NOT NULL,
  referencia_retiro  TEXT NOT NULL,
  foto_url           TEXT,
  token              TEXT NOT NULL UNIQUE,
  creado_en          TEXT NOT NULL
);

CREATE TABLE hornadas (
  id                 TEXT PRIMARY KEY,
  cocinero_id        TEXT NOT NULL REFERENCES cocineros(id),
  pan                TEXT NOT NULL,
  desde              TEXT NOT NULL,
  hasta              TEXT NOT NULL,
  unidades           INTEGER NOT NULL CHECK (unidades > 0),
  disponibles        INTEGER NOT NULL CHECK (disponibles >= 0),
  precio             INTEGER NOT NULL CHECK (precio > 0),
  modalidades        TEXT NOT NULL,
  referencia_retiro  TEXT NOT NULL,
  estado             TEXT NOT NULL,
  creada_en          TEXT NOT NULL
);

CREATE TABLE reservas (
  id          TEXT PRIMARY KEY,
  hornada_id  TEXT NOT NULL REFERENCES hornadas(id),
  codigo      TEXT NOT NULL UNIQUE,
  nombre      TEXT NOT NULL,
  contacto    TEXT NOT NULL,
  unidades    INTEGER NOT NULL CHECK (unidades > 0),
  modalidad   TEXT NOT NULL,
  direccion   TEXT,
  total       INTEGER NOT NULL,
  estado      TEXT NOT NULL,
  creada_en   TEXT NOT NULL
);

CREATE TABLE resenas (
  id           TEXT PRIMARY KEY,
  reserva_id   TEXT NOT NULL UNIQUE REFERENCES reservas(id),
  cocinero_id  TEXT NOT NULL REFERENCES cocineros(id),
  estrellas    INTEGER NOT NULL CHECK (estrellas BETWEEN 1 AND 5),
  comentario   TEXT,
  creada_en    TEXT NOT NULL
);
