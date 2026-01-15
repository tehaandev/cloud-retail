import { useEffect, useState, useContext } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Container, Card, Form, Button, Alert, Spinner } from "react-bootstrap";
import { PRODUCT_API, ORDER_API } from "../api/client";
import type { Product } from "../types";
import { AuthContext } from "../context/AuthContext";

const CheckoutPage = () => {
  const { productId } = useParams<{ productId: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [placingOrder, setPlacingOrder] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const { user } = useContext(AuthContext);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const res = await PRODUCT_API.get(`/products/${productId}`);
        setProduct(res.data);
      } catch (err: unknown) {
        console.error(err);
        setError("Product not found");
      } finally {
        setLoading(false);
      }
    };
    fetchProduct();
  }, [productId]);

  const handleOrder = async () => {
    if (!product || !user) return;
    setPlacingOrder(true);
    setError("");

    try {
      await ORDER_API.post("/orders", {
        userId: user.id, // In real app, backend extracts this from JWT
        productId: product.id,
        quantity: quantity,
      });
      setSuccess("Order placed successfully! Redirecting...");
      setTimeout(() => navigate("/"), 2000);
    } catch (err: unknown) {
      console.error(err);
      setError("Failed to place order");
    } finally {
      setPlacingOrder(false);
    }
  };

  if (loading)
    return (
      <Container className="text-center mt-5">
        <Spinner animation="border" />
      </Container>
    );
  if (!product)
    return (
      <Container className="mt-5">
        <Alert variant="danger">Product not found</Alert>
      </Container>
    );

  return (
    <Container className="mt-5" style={{ maxWidth: "600px" }}>
      <h2 className="mb-4">Checkout</h2>
      {error && <Alert variant="danger">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      <Card>
        <Card.Body>
          <Card.Title>{product.name}</Card.Title>
          <Card.Text>{product.description}</Card.Text>
          <hr />
          <h5>Price: ${product.price}</h5>

          <Form.Group className="mb-3 mt-3">
            <Form.Label>Quantity</Form.Label>
            <Form.Control
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value))}
            />
          </Form.Group>

          <div className="d-flex justify-content-between align-items-center mt-4">
            <h4>Total: ${(product.price * quantity).toFixed(2)}</h4>
            <Button
              variant="success"
              size="lg"
              onClick={handleOrder}
              disabled={placingOrder}
            >
              {placingOrder ? "Processing..." : "Place Order"}
            </Button>
          </div>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default CheckoutPage;

