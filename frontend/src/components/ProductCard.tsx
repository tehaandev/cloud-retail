import { Card, Button } from "react-bootstrap";
import type { Product } from "../types";
import { useNavigate } from "react-router-dom";

interface Props {
  product: Product;
}

const ProductCard = ({ product }: Props) => {
  const navigate = useNavigate();

  return (
    <Card className="h-100">
      <Card.Body className="d-flex flex-column">
        <Card.Title>{product.name}</Card.Title>
        <Card.Text>{product.description}</Card.Text>
        <div className="mt-auto">
          <h5 className="mb-3">${product.price}</h5>
          <Button
            variant="primary"
            onClick={() => navigate(`/checkout/${product.id}`)}
          >
            Buy Now
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
};

export default ProductCard;

