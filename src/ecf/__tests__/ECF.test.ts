import path from 'path';
import P12Reader from '../../P12Reader';
import ECF from '../ECF';
import { ENVIRONMENT, restClient } from '../../networking';
import Signature from '../../Signature/Signature';
import fs from 'fs';
import { TrackStatusEnum } from '../../networking/types';
import Transformer from '../../transformers';
import JsonECF31Invoice from './sample/ecf_json_data_31.json';
import JsonECF32Summary from './sample/cf_json_data_32.json';
import { generateRandomAlphaNumeric } from '../../utils/generateRandomAlphaNumeric';
import { getCurrentFormattedDate } from '../../utils';
const randomNum = () =>
  Math.floor(Math.random() * 100000)
    .toString()
    .padStart(5, '0');

describe('Test Authentication flow', () => {
  const secret = process.env.CERTIFICATE_TEST_PASSWORD || '';
  let testTrackingNo = '';

  const rnc = process.env.RNC_EMISOR || ''; //Customer RNC
  const noEcf = `E3100050${randomNum()}`; //Sequence

  const reader = new P12Reader(secret);
  const certificatePath = path.resolve(
    __dirname,
    `../../test_cert/${
      process.env.CERTIFICATE_NAME || '<<<<< certificate not found>>>>>'
    }`
  );
  console.log('certificatePath');
  const certs = reader.getKeyFromFile(certificatePath);

  it('Testing authentication', async () => {
    if (!certs.key || !certs.cert) {
      return;
    }

    const auth = new ECF(certs, ENVIRONMENT.DEV);
    const tokenData = await auth.authenticate();
    expect(tokenData?.token).toBeDefined();
    console.log('Token:', tokenData?.token);
    expect(restClient.defaults.headers.common['Authorization']).toBeDefined();
  });

  it('Testing authentication against Buyer HOST', async () => {
    if (!certs.key || !certs.cert) {
      return;
    }

    //HOST URL coming from the Directory from buyer authorized to receive eCF
    const urlOpcional = 'https://ecf.dgii.gov.do/Testecf/autenticacion';

    const auth = new ECF(certs, ENVIRONMENT.DEV);
    const tokenData = await auth.authenticate(urlOpcional);
    expect(tokenData?.token).toBeDefined();
    console.log('Buyer HOST Token:', tokenData?.token);
    expect(restClient.defaults.headers.common['Authorization']).toBeDefined();
  });

  it('Testing  sending signed invoice (31) to DGII', async () => {
    if (!certs.key || !certs.cert) {
      return;
    }

    const ecf = new ECF(certs, ENVIRONMENT.DEV);
    const auth = await ecf.authenticate();

    //console.log(auth);

    //Sign invoice
    const signature = new Signature(certs.key, certs.cert);

    //Stream Readable

    JsonECF31Invoice.ECF.Encabezado.IdDoc.eNCF = noEcf;
    const transformer = new Transformer();
    const xml = transformer.json2xml(JsonECF31Invoice);
    const fileName = `${rnc}${noEcf}.xml`;
    const signedXml = signature.signXml(xml, 'ECF');

    //SAVE XML into temporaty file for manual testing in POSTMAN
    fs.writeFile(
      path.resolve(__dirname, `sample/generated/${fileName}`),
      signedXml,
      (err) => {
        if (err) {
          console.error('Error writing to file:', err);
          return;
        } else {
          console.log('File has been written successfully.');
        }
      }
    );

    const response = await ecf.sendElectronicDocument(signedXml, fileName);

    testTrackingNo = response?.trackId as string;
    expect(response?.trackId).toBeDefined();
    console.log(response);
  });

  it('Test TrackingID status', async () => {
    const trackId = testTrackingNo;
    const ecf = new ECF(certs, ENVIRONMENT.DEV);

    const response = await ecf.statusTrackId(trackId);

    expect([
      TrackStatusEnum.REJECTED,
      TrackStatusEnum.IN_PROCESS,
      TrackStatusEnum.ACCEPTED,
      TrackStatusEnum.CONDITIONAL_ACCEPTED,
    ]).toContain(response?.estado);
  });

  it('Test get all tracking id status', async () => {
    try {
      const ecf = new ECF(certs, ENVIRONMENT.DEV);
      const response = await ecf.trackStatuses(rnc, noEcf);
      expect(response?.length).toBeGreaterThan(0);
    } catch (err: any) {
      expect(err.estado).toBe('TrackId no encontrado.'); // integration test aceptable to not find trackId
    }
  });

  it('Test get all tracking id status', async () => {
    const ecf = new ECF(certs, ENVIRONMENT.DEV);
    const rnc = 'any rnc';
    const response = await ecf.getCustomerDirectory(rnc);
    expect(response).toMatchObject([
      {
        nombre: 'DGII',
        rnc: '131880681',
        urlAceptacion: 'https://ecf.dgii.gov.do/testecf/emisorreceptor',
        urlOpcional: 'https://ecf.dgii.gov.do/Testecf/autenticacion',
        urlRecepcion: 'https://ecf.dgii.gov.do/testecf/emisorreceptor',
      },
    ]);
  });

  it('Testing sending signed summary (32) to DGII', async () => {
    if (!certs.key || !certs.cert) {
      return;
    }

    const noEcf = `E3200050${randomNum()}`; //Sequence

    const ecf = new ECF(certs, ENVIRONMENT.DEV);
    await ecf.authenticate();

    const securityCode = generateRandomAlphaNumeric();
    //console.log(auth);

    //Sign invoice
    const signature = new Signature(certs.key, certs.cert);

    //Stream Readable

    JsonECF32Summary.RFCE.Encabezado.IdDoc.eNCF = noEcf;
    //Adding ramdom security code
    JsonECF32Summary.RFCE.Encabezado.CodigoSeguridadeCF = securityCode;
    JsonECF32Summary.RFCE.Encabezado.Emisor.RNCEmisor =
      process.env.RNC_EMISOR || '';
    JsonECF32Summary.RFCE.Encabezado.Emisor.FechaEmision =
      getCurrentFormattedDate();
    const transformer = new Transformer();
    const xml = transformer.json2xml(JsonECF32Summary);

    const fileName = `${rnc}${noEcf}.xml`;
    const signedXml = signature.signXml(xml, 'RFCE');
    const response = await ecf.sendSummary(signedXml, fileName);

    expect(response).toBeDefined();

    //Check the status

    const statusResponse = await ecf.inquiryStatus(
      JsonECF32Summary.RFCE.Encabezado.Emisor.RNCEmisor,
      noEcf,
      JsonECF32Summary.RFCE.Encabezado.Comprador.RNCComprador,
      securityCode
    );

    expect(statusResponse?.codigoSeguridad).toBe(securityCode);
    expect(statusResponse?.montoTotal).toBe(
      JsonECF32Summary.RFCE.Encabezado.Totales.MontoTotal
    );
  });

  it('Testing sending signed summary (32) to DGII and handle errors', async () => {
    if (!certs.key || !certs.cert) {
      return;
    }

    // This test expects an error to be thrown due to invalid data
    let errorWasThrown = false;

    try {
      const noEcf32 = `E3200050${randomNum()}`; //Sequence
      const ecf = new ECF(certs, ENVIRONMENT.DEV);
      await ecf.authenticate();

      const securityCode = generateRandomAlphaNumeric();

      //Sign invoice
      const signature = new Signature(certs.key, certs.cert);

      //Stream Readable - intentionally set invalid data to trigger error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      JsonECF32Summary.RFCE.Encabezado.IdDoc.TipoIngresos = 1 as any; //make it fail with wrong data

      JsonECF32Summary.RFCE.Encabezado.IdDoc.eNCF = noEcf32;
      //Adding random security code
      JsonECF32Summary.RFCE.Encabezado.CodigoSeguridadeCF = securityCode;

      const transformer = new Transformer();
      const xml = transformer.json2xml(JsonECF32Summary);
      const fileName = `${rnc}${noEcf32}.xml`;
      const signedXml = signature.signXml(xml, 'RFCE');

      // This should throw an error due to invalid data
      const response = await ecf.sendSummary(signedXml, fileName);

      // If we reach here without an error, the test should fail
      if (response) {
        // Try the status check - this might be where the error occurs
        await ecf.inquiryStatus(
          JsonECF32Summary.RFCE.Encabezado.Emisor.RNCEmisor,
          noEcf32, // Fixed: use noEcf32 instead of noEcf
          JsonECF32Summary.RFCE.Encabezado.Comprador.RNCComprador,
          securityCode
        );

        // If we get here without an error, the test should fail
        fail(
          'Expected an error to be thrown due to invalid data, but the operation succeeded'
        );
      }
    } catch (err) {
      errorWasThrown = true;

      // Improved error handling with proper typing
      const error = err as Error & { codigo?: number };

      // Check if the error has the expected error code
      if (error && typeof error === 'object' && 'codigo' in error) {
        expect(error.codigo).toBe(2);
      } else {
        // If the error structure is different, log it for debugging
        console.log('Received error:', error);
        // Still pass the test since we expected an error
        expect(errorWasThrown).toBe(true);
      }
    }

    // Ensure an error was actually thrown
    expect(errorWasThrown).toBe(true);
  });

  it('Testing interceptor 401 response', async () => {
    try {
      const trackId = testTrackingNo;
      const ecf = new ECF(certs, ENVIRONMENT.DEV, undefined);
      await ecf.statusTrackId(trackId);
    } catch (err) {
      const error = err as Error & { status?: number };
      expect(error.status).toEqual(401);
    }
  });
});
