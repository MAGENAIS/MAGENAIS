import { Bootstrap } from "./bootstrap/Bootstrap";

async function main() {

    const bootstrap = new Bootstrap();

    await bootstrap.start();

}

main().catch(console.error);
