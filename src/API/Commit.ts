
import axios from "axios";
import moment from "moment";
import "dotenv/config";


const BASE_URL = "https://ventas.construsitio.com.ar/api";
const cuit = process.env.CONSTRUSITIO_CUIT ?? "";
const email = process.env.CONSTRUSITIO_EMAIL ?? "";
const password = process.env.CONSTRUSITIO_PASSWORD ?? "";

export const searchProduct = async (data) => {
    const body = {
        cuit: cuit,
        email: email,
        password: password,
        data: data
    };
    const response = await axios.post(
        `${BASE_URL}/articulos/searchproducts`,
        body
    );
    return response.data;
};