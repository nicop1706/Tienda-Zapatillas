const predictionService = require('../servicios/prediccionServicio');
const { asyncHandler } = require('../utilidades/errores');
const { ok } = require('../utilidades/respuesta');

const historial = asyncHandler(async (req, res) => ok(res, await predictionService.obtenerHistorial()));
const entrenar = asyncHandler(async (req, res) => ok(res, await predictionService.entrenar(req.body), undefined, 201));
const predecir = asyncHandler(async (req, res) => ok(res, await predictionService.predecir(req.body, req.usuario && req.usuario.id)));
const pronostico = asyncHandler(async (req, res) => ok(res, await predictionService.pronostico(req.body)));
const metricas = asyncHandler(async (req, res) => ok(res, await predictionService.obtenerMetricas()));
const registro = asyncHandler(async (req, res) => ok(res, await predictionService.registroPredicciones()));
const importar = asyncHandler(async (req, res) => ok(res, await predictionService.importarCsv(req.body), undefined, 201));

module.exports = { registro, pronostico, historial, entrenar, predecir, metricas, importar };
