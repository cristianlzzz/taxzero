-- Etapa 3 (parte 1): nuevo tipo de documento por huésped, opcional: gafete o constancia
-- de participación del evento. Va en su propia migración porque un valor nuevo de un
-- tipo no se puede usar en la misma transacción en que se agrega.
alter type tipo_doc add value if not exists 'constancia';
